import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'

const VALID_KINDS = ['url', 'drive', 'upload'] as const
const VALID_STATUSES = ['queued', 'reading', 'done'] as const

/**
 * GET /api/personal/reading?status=queued|reading|done
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const db = getDatabase()
  const url = new URL(request.url)
  const status = url.searchParams.get('status') || ''
  let rows
  if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
    rows = db.prepare(`
      SELECT id, kind, title, url, drive_file_id, status, notes, added_at, updated_at
      FROM reading_sources WHERE user_id = ? AND status = ?
      ORDER BY added_at DESC LIMIT 200
    `).all(user.id, status)
  } else {
    rows = db.prepare(`
      SELECT id, kind, title, url, drive_file_id, status, notes, added_at, updated_at
      FROM reading_sources WHERE user_id = ?
      ORDER BY added_at DESC LIMIT 200
    `).all(user.id)
  }
  return NextResponse.json({ sources: rows })
}

/**
 * POST /api/personal/reading  { kind, title, url?, drive_file_id?, notes? }
 */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  let body: any = {}
  try { body = await request.json() } catch {}
  const kind = String(body.kind || 'url')
  if (!(VALID_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  }
  const title = String(body.title || '').trim().slice(0, 500)
  if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
  const url = body.url ? String(body.url).slice(0, 2000) : null
  const driveFileId = body.drive_file_id ? String(body.drive_file_id).slice(0, 200) : null
  const notes = body.notes ? String(body.notes).slice(0, 10_000) : null

  const db = getDatabase()
  const info = db.prepare(`
    INSERT INTO reading_sources (user_id, kind, title, url, drive_file_id, status, notes)
    VALUES (?, ?, ?, ?, ?, 'queued', ?)
  `).run(user.id, kind, title, url, driveFileId, notes)

  logAuditEvent({
    action: 'personal_reading_add',
    actor: user.username,
    actor_id: user.id,
    target_type: 'reading_source',
    target_id: Number(info.lastInsertRowid),
    detail: { kind, title },
  })

  return NextResponse.json({ id: Number(info.lastInsertRowid) })
}

/**
 * PATCH /api/personal/reading  { id, status?, notes?, title? }
 */
export async function PATCH(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  let body: any = {}
  try { body = await request.json() } catch {}
  const id = Number(body.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = getDatabase()
  const existing = db.prepare('SELECT id FROM reading_sources WHERE id = ? AND user_id = ?').get(id, user.id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updates: string[] = []
  const args: any[] = []
  if (body.status && (VALID_STATUSES as readonly string[]).includes(body.status)) {
    updates.push('status = ?')
    args.push(body.status)
  }
  if (typeof body.notes === 'string') {
    updates.push('notes = ?')
    args.push(body.notes.slice(0, 10_000))
  }
  if (typeof body.title === 'string' && body.title.trim()) {
    updates.push('title = ?')
    args.push(body.title.trim().slice(0, 500))
  }
  if (!updates.length) return NextResponse.json({ ok: true })
  updates.push('updated_at = unixepoch()')
  args.push(id, user.id)
  db.prepare(`UPDATE reading_sources SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...args)

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/personal/reading?id=…
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
  db.prepare('DELETE FROM reading_sources WHERE id = ? AND user_id = ?').run(id, user.id)
  return NextResponse.json({ ok: true })
}
