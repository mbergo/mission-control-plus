import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'

/**
 * GET /api/personal/flashcards?due=1 — list cards (optionally only due)
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const db = getDatabase()
  const url = new URL(request.url)
  const due = url.searchParams.get('due') === '1'
  const now = Math.floor(Date.now() / 1000)
  const rows = due
    ? db.prepare(`
        SELECT id, source_id, front, back, ease, interval_days, due_at, reviewed_count
        FROM flashcards WHERE user_id = ? AND due_at <= ?
        ORDER BY due_at ASC LIMIT 200
      `).all(user.id, now)
    : db.prepare(`
        SELECT id, source_id, front, back, ease, interval_days, due_at, reviewed_count
        FROM flashcards WHERE user_id = ?
        ORDER BY due_at ASC LIMIT 500
      `).all(user.id)
  return NextResponse.json({ flashcards: rows, now })
}

/**
 * POST /api/personal/flashcards  { front, back, source_id? }
 */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  let body: any = {}
  try { body = await request.json() } catch {}
  const front = String(body.front || '').trim().slice(0, 1000)
  const back = String(body.back || '').trim().slice(0, 4000)
  if (!front || !back) {
    return NextResponse.json({ error: 'front and back required' }, { status: 400 })
  }
  const sourceId = body.source_id ? Number(body.source_id) : null
  const db = getDatabase()
  const info = db.prepare(`
    INSERT INTO flashcards (user_id, source_id, front, back)
    VALUES (?, ?, ?, ?)
  `).run(user.id, sourceId, front, back)
  return NextResponse.json({ id: Number(info.lastInsertRowid) })
}

/**
 * PATCH /api/personal/flashcards  { id, quality: 0..5 }
 * Applies an SM-2-lite update to ease/interval/due_at based on review quality.
 */
export async function PATCH(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  let body: any = {}
  try { body = await request.json() } catch {}
  const id = Number(body.id)
  const quality = Math.max(0, Math.min(5, Number(body.quality)))
  if (!id || Number.isNaN(quality)) {
    return NextResponse.json({ error: 'id and quality required' }, { status: 400 })
  }
  const db = getDatabase()
  const card = db.prepare(`
    SELECT id, ease, interval_days, reviewed_count FROM flashcards
    WHERE id = ? AND user_id = ?
  `).get(id, user.id) as { id: number; ease: number; interval_days: number; reviewed_count: number } | undefined
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // SM-2 lite: failure resets interval, success increases by ease factor.
  let ease = card.ease
  let interval = card.interval_days
  if (quality < 3) {
    interval = 1
    ease = Math.max(1.3, ease - 0.2)
  } else {
    if (card.reviewed_count === 0) interval = 1
    else if (card.reviewed_count === 1) interval = 6
    else interval = Math.round(card.interval_days * ease)
    ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
  }
  const dueAt = Math.floor(Date.now() / 1000) + interval * 86400
  db.prepare(`
    UPDATE flashcards
    SET ease = ?, interval_days = ?, due_at = ?, reviewed_count = reviewed_count + 1, last_reviewed_at = unixepoch()
    WHERE id = ? AND user_id = ?
  `).run(ease, interval, dueAt, id, user.id)

  logAuditEvent({
    action: 'personal_flashcard_review',
    actor: user.username,
    actor_id: user.id,
    target_type: 'flashcard',
    target_id: id,
    detail: { quality, interval_days: interval },
  })

  return NextResponse.json({ id, ease, interval_days: interval, due_at: dueAt })
}

/**
 * DELETE /api/personal/flashcards?id=…
 */
export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const url = new URL(request.url)
  const id = Number(url.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = getDatabase()
  db.prepare('DELETE FROM flashcards WHERE id = ? AND user_id = ?').run(id, user.id)
  return NextResponse.json({ ok: true })
}
