import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { GOOGLE_SCOPES, googleApiFetch, hasScope, loadTokens } from '@/lib/google-oauth'
import { getDatabase, logAuditEvent } from '@/lib/db'

interface GCalEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>
  hangoutLink?: string
  htmlLink?: string
}

/**
 * GET /api/google/calendar/agenda?days=2
 * Returns events from now through `days` days ahead (default 2).
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const tokens = loadTokens(user.id)
  if (!tokens) {
    return NextResponse.json({ error: 'Google account not connected' }, { status: 412 })
  }
  if (!hasScope(tokens, GOOGLE_SCOPES.calendarReadonly) && !hasScope(tokens, GOOGLE_SCOPES.calendarEvents)) {
    return NextResponse.json({ error: 'Missing calendar.readonly scope' }, { status: 403 })
  }

  const url = new URL(request.url)
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '2', 10), 1), 14)
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const apiUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `singleEvents=true&orderBy=startTime` +
    `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=50`

  const res = await googleApiFetch(user.id, apiUrl)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    return NextResponse.json({ error: 'Calendar list failed', detail: txt.slice(0, 200) }, { status: res.status })
  }
  const json = await res.json() as { items?: GCalEvent[] }
  const events = (json.items || []).map(e => {
    const startStr = e.start?.dateTime || e.start?.date || ''
    const endStr = e.end?.dateTime || e.end?.date || ''
    const startTs = startStr ? Math.floor(new Date(startStr).getTime() / 1000) : null
    const endTs = endStr ? Math.floor(new Date(endStr).getTime() / 1000) : null
    return {
      id: e.id,
      title: e.summary || '(no title)',
      description: e.description || '',
      location: e.location || '',
      start: startStr,
      end: endStr,
      startTs,
      endTs,
      attendees: (e.attendees || []).map(a => ({
        email: a.email || '',
        name: a.displayName || '',
        response: a.responseStatus || '',
      })),
      conferenceUrl: e.hangoutLink || '',
      htmlLink: e.htmlLink || '',
    }
  })

  try {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO calendar_event_cache (user_id, event_id, calendar_id, title, start_ts, end_ts, attendees, location, description, last_synced)
      VALUES (?, ?, 'primary', ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, event_id) DO UPDATE SET
        title = excluded.title,
        start_ts = excluded.start_ts,
        end_ts = excluded.end_ts,
        attendees = excluded.attendees,
        location = excluded.location,
        description = excluded.description,
        last_synced = excluded.last_synced
    `)
    const txn = db.transaction((rows: typeof events) => {
      for (const e of rows) {
        stmt.run(
          user.id,
          e.id,
          e.title,
          e.startTs,
          e.endTs,
          JSON.stringify(e.attendees),
          e.location,
          e.description.slice(0, 4000),
        )
      }
    })
    txn(events)
  } catch {}

  logAuditEvent({
    action: 'google_calendar_agenda',
    actor: user.username,
    actor_id: user.id,
    detail: { count: events.length, days },
  })

  return NextResponse.json({ events })
}
