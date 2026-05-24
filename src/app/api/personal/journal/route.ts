import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'

function isoDate(d = new Date()): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * GET /api/personal/journal?date=YYYY-MM-DD — fetch a single entry (defaults to today)
 * GET /api/personal/journal?list=1&limit=30 — list recent entries
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const db = getDatabase()
  const url = new URL(request.url)
  if (url.searchParams.get('list')) {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10), 1), 365)
    const rows = db.prepare(`
      SELECT id, entry_date, mood, energy, length(content_md) AS chars, updated_at
      FROM journal_entries WHERE user_id = ?
      ORDER BY entry_date DESC LIMIT ?
    `).all(user.id, limit)
    return NextResponse.json({ entries: rows })
  }
  const date = url.searchParams.get('date') || isoDate()
  const row = db.prepare(`
    SELECT id, entry_date, mood, energy, content_md, created_at, updated_at
    FROM journal_entries WHERE user_id = ? AND entry_date = ?
  `).get(user.id, date)
  return NextResponse.json({ entry: row || null, date })
}

/**
 * POST /api/personal/journal  { date?: 'YYYY-MM-DD', mood?: number, energy?: number, content_md?: string }
 * Upsert a journal entry for the given date (defaults to today).
 */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  let body: any = {}
  try { body = await request.json() } catch {}
  const date = String(body.date || isoDate()).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }
  const mood = body.mood == null ? null : Math.max(1, Math.min(5, Number(body.mood)))
  const energy = body.energy == null ? null : Math.max(1, Math.min(5, Number(body.energy)))
  const content = String(body.content_md ?? '').slice(0, 100_000)

  const db = getDatabase()
  db.prepare(`
    INSERT INTO journal_entries (user_id, entry_date, mood, energy, content_md, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(user_id, entry_date) DO UPDATE SET
      mood = excluded.mood,
      energy = excluded.energy,
      content_md = excluded.content_md,
      updated_at = unixepoch()
  `).run(user.id, date, mood, energy, content)

  logAuditEvent({
    action: 'personal_journal_upsert',
    actor: user.username,
    actor_id: user.id,
    detail: { date, has_content: content.length > 0, mood, energy },
  })

  return NextResponse.json({ ok: true })
}
