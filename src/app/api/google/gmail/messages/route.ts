import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { GOOGLE_SCOPES, googleApiFetch, hasScope, loadTokens } from '@/lib/google-oauth'
import { logAuditEvent, getDatabase } from '@/lib/db'

interface GmailMessageHeader { name: string; value: string }
interface GmailMessage {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  labelIds?: string[]
  payload?: { headers?: GmailMessageHeader[] }
}

/**
 * GET /api/google/gmail/messages?q=is:unread&max=20
 * Returns recent message summaries. Read-only — requires gmail.readonly or gmail.modify.
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
  if (!hasScope(tokens, GOOGLE_SCOPES.gmailReadonly) && !hasScope(tokens, GOOGLE_SCOPES.gmailModify)) {
    return NextResponse.json({ error: 'Missing gmail.readonly scope' }, { status: 403 })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q') || 'newer_than:1d'
  const max = Math.min(Math.max(parseInt(url.searchParams.get('max') || '20', 10), 1), 50)

  // List
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`
  const listRes = await googleApiFetch(user.id, listUrl)
  if (!listRes.ok) {
    const txt = await listRes.text().catch(() => '')
    return NextResponse.json({ error: 'Gmail list failed', detail: txt.slice(0, 200) }, { status: listRes.status })
  }
  const listJson = await listRes.json() as { messages?: Array<{ id: string; threadId: string }> }
  const ids = (listJson.messages || []).map(m => m.id)

  // Fetch metadata in parallel (capped)
  const details = await Promise.all(ids.slice(0, max).map(async id => {
    const r = await googleApiFetch(
      user.id,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    )
    if (!r.ok) return null
    return (await r.json()) as GmailMessage
  }))

  const messages = details.filter(Boolean).map(m => {
    const headers = m!.payload?.headers || []
    const header = (n: string) => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || ''
    return {
      id: m!.id,
      threadId: m!.threadId,
      snippet: m!.snippet || '',
      from: header('From'),
      subject: header('Subject'),
      date: header('Date'),
      labels: m!.labelIds || [],
      internalDate: m!.internalDate ? Number(m!.internalDate) : null,
    }
  })

  // Cache lightweight summaries (no body) for the briefing/triage agents to pick up.
  try {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO gmail_thread_cache (user_id, thread_id, snippet, subject, from_addr, labels, internal_date, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, thread_id) DO UPDATE SET
        snippet = excluded.snippet,
        subject = excluded.subject,
        from_addr = excluded.from_addr,
        labels = excluded.labels,
        internal_date = excluded.internal_date,
        last_synced = excluded.last_synced
    `)
    const txn = db.transaction((rows: typeof messages) => {
      for (const m of rows) {
        stmt.run(
          user.id,
          m.threadId,
          m.snippet,
          m.subject,
          m.from,
          (m.labels || []).join(','),
          m.internalDate,
        )
      }
    })
    txn(messages)
  } catch {}

  logAuditEvent({
    action: 'google_gmail_list',
    actor: user.username,
    actor_id: user.id,
    detail: { count: messages.length, q },
  })

  return NextResponse.json({ messages })
}
