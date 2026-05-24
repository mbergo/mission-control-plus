import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { redactEmail } from '@/lib/google-oauth'
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

/**
 * GET /api/personal/briefings
 * List the most recent briefings for the user.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const db = getDatabase()
  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const rows = db.prepare(`
    SELECT id, kind, generated_at, model_used, cost_usd, substr(content_md, 1, 4000) AS content_md
    FROM briefings WHERE user_id = ?
    ORDER BY generated_at DESC LIMIT ?
  `).all(user.id, limit)
  return NextResponse.json({ briefings: rows })
}

/**
 * POST /api/personal/briefings  { kind?: 'morning'|'evening'|'weekly' }
 * Generates a deterministic markdown briefing from local caches (no LLM call).
 * AI agents wired into the existing skills framework can later post their own
 * richer briefings via this same endpoint by passing { content_md, model_used }.
 */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: any = {}
  try { body = await request.json() } catch {}
  const kind = String(body.kind || 'morning')
  if (!['morning', 'evening', 'weekly'].includes(kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  }

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  let contentMd = ''
  let modelUsed = 'mc:deterministic'

  // If the caller provided pre-generated content (e.g. from an AI skill), persist as-is.
  if (typeof body.content_md === 'string' && body.content_md.trim().length > 0) {
    contentMd = String(body.content_md)
    modelUsed = String(body.model_used || modelUsed)
  } else {
    // Deterministic fallback: assemble brief from local Google caches.
    const upcomingHorizon = kind === 'weekly' ? now + 7 * 86400 : now + 36 * 3600

    const events = db.prepare(`
      SELECT event_id, title, start_ts, end_ts, attendees, location
      FROM calendar_event_cache
      WHERE user_id = ? AND (end_ts IS NULL OR end_ts >= ?) AND (start_ts IS NULL OR start_ts <= ?)
      ORDER BY start_ts ASC LIMIT 25
    `).all(user.id, now, upcomingHorizon) as CachedEvent[]

    const threads = db.prepare(`
      SELECT thread_id, subject, from_addr, snippet, internal_date, labels
      FROM gmail_thread_cache
      WHERE user_id = ? AND (internal_date IS NULL OR internal_date >= ?)
      ORDER BY internal_date DESC NULLS LAST LIMIT 8
    `).all(user.id, (kind === 'weekly' ? now - 7 * 86400 : now - 86400) * 1000) as CachedThread[]

    const dueCards = db.prepare(`
      SELECT COUNT(*) AS n FROM flashcards WHERE user_id = ? AND due_at <= ?
    `).get(user.id, now) as { n: number }

    const reading = db.prepare(`
      SELECT title, status FROM reading_sources WHERE user_id = ? AND status = 'queued'
      ORDER BY added_at DESC LIMIT 5
    `).all(user.id) as Array<{ title: string; status: string }>

    const lines: string[] = []
    const title = kind === 'morning' ? 'Morning brief' : kind === 'evening' ? 'Evening wrap' : 'Weekly review'
    lines.push(`# ${title} — ${new Date(now * 1000).toISOString().slice(0, 10)}`, '')

    lines.push('## Calendar')
    if (events.length === 0) {
      lines.push('_No events on the horizon._', '')
    } else {
      for (const e of events) {
        const when = e.start_ts ? new Date(e.start_ts * 1000).toLocaleString() : 'TBD'
        const where = e.location ? ` — ${e.location}` : ''
        lines.push(`- **${when}** · ${e.title}${where}`)
      }
      lines.push('')
    }

    lines.push('## Inbox highlights')
    if (threads.length === 0) {
      lines.push('_No recent threads cached. Open Inbox to refresh._', '')
    } else {
      for (const t of threads) {
        const from = redactEmail((t.from_addr || '').match(/<([^>]+)>/)?.[1] || t.from_addr || '')
        lines.push(`- ${t.subject || '(no subject)'} — ${from || 'unknown'}\n  > ${(t.snippet || '').slice(0, 200)}`)
      }
      lines.push('')
    }

    lines.push('## Learning')
    lines.push(`- Flashcards due: **${dueCards?.n || 0}**`)
    if (reading.length > 0) {
      lines.push('- Reading queue:')
      for (const r of reading) lines.push(`  - ${r.title}`)
    }
    lines.push('')

    if (config.personalAiLocalOnly) {
      lines.push('---', '_AI Local-only mode is enabled: this brief was assembled locally without sending data to any external model._')
    }

    contentMd = lines.join('\n')
  }

  const info = db.prepare(`
    INSERT INTO briefings (user_id, kind, generated_at, content_md, model_used, cost_usd)
    VALUES (?, ?, unixepoch(), ?, ?, ?)
  `).run(user.id, kind, contentMd, modelUsed, body.cost_usd ?? null)

  logAuditEvent({
    action: 'personal_briefing_generated',
    actor: user.username,
    actor_id: user.id,
    target_type: 'briefing',
    target_id: Number(info.lastInsertRowid),
    detail: { kind, model_used: modelUsed, chars: contentMd.length },
  })

  return NextResponse.json({ id: Number(info.lastInsertRowid), kind, content_md: contentMd, model_used: modelUsed })
}
