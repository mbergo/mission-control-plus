import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'

interface CachedEvent {
  event_id: string
  title: string
  start_ts: number | null
  end_ts: number | null
  attendees: string | null
  location: string | null
}
interface CachedThread {
  thread_id: string
  subject: string | null
  from_addr: string | null
  snippet: string | null
  internal_date: number | null
  labels: string | null
}
interface BriefingRow {
  id: number
  kind: string
  generated_at: number
  content_md: string
  model_used: string | null
}

/**
 * GET /api/personal/today
 * Aggregates today's cached agenda, recent Gmail summaries, due flashcards,
 * journal status, and most-recent briefing into a single dashboard payload.
 * Pulls from local caches only — call the Google routes first to refresh data.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const db = getDatabase()

  const now = Math.floor(Date.now() / 1000)
  const endOfTomorrow = now + 48 * 60 * 60

  const events = db.prepare(`
    SELECT event_id, title, start_ts, end_ts, attendees, location
    FROM calendar_event_cache
    WHERE user_id = ? AND (end_ts IS NULL OR end_ts >= ?) AND (start_ts IS NULL OR start_ts <= ?)
    ORDER BY start_ts ASC
    LIMIT 25
  `).all(user.id, now, endOfTomorrow) as CachedEvent[]

  const recentThreads = db.prepare(`
    SELECT thread_id, subject, from_addr, snippet, internal_date, labels
    FROM gmail_thread_cache
    WHERE user_id = ?
    ORDER BY internal_date DESC NULLS LAST
    LIMIT 10
  `).all(user.id) as CachedThread[]

  const dueFlashcards = db.prepare(`
    SELECT COUNT(*) AS n FROM flashcards WHERE user_id = ? AND due_at <= ?
  `).get(user.id, now) as { n: number }

  const today = new Date()
  const yyyy = today.getUTCFullYear()
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(today.getUTCDate()).padStart(2, '0')
  const todayDate = `${yyyy}-${mm}-${dd}`
  const todayJournal = db.prepare(`
    SELECT id, mood, energy, length(content_md) AS chars
    FROM journal_entries WHERE user_id = ? AND entry_date = ?
  `).get(user.id, todayDate) as { id: number; mood: number | null; energy: number | null; chars: number } | undefined

  const latestBriefing = db.prepare(`
    SELECT id, kind, generated_at, content_md, model_used
    FROM briefings WHERE user_id = ?
    ORDER BY generated_at DESC LIMIT 1
  `).get(user.id) as BriefingRow | undefined

  const queuedReading = db.prepare(`
    SELECT id, title, kind, url, status, added_at
    FROM reading_sources WHERE user_id = ? AND status = 'queued'
    ORDER BY added_at DESC LIMIT 10
  `).all(user.id) as Array<{ id: number; title: string; kind: string; url: string | null; status: string; added_at: number }>

  logAuditEvent({
    action: 'personal_today_view',
    actor: user.username,
    actor_id: user.id,
  })

  return NextResponse.json({
    mode: config.mcMode,
    now,
    events,
    recentThreads,
    dueFlashcards: dueFlashcards?.n || 0,
    journalToday: todayJournal || null,
    latestBriefing: latestBriefing || null,
    queuedReading,
  })
}
