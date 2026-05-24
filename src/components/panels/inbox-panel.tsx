'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface GmailMessage {
  id: string
  threadId: string
  snippet: string
  from: string
  subject: string
  date: string
  labels: string[]
}

interface GoogleStatus {
  connected: boolean
  configured: boolean
  scopes: string[]
  capabilities: { gmail_read?: boolean }
}

export function InboxPanel() {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [messages, setMessages] = useState<GmailMessage[]>([])
  const [query, setQuery] = useState('newer_than:1d')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/google/auth/status')
      if (r.ok) setStatus(await r.json())
    } catch {}
  }, [])

  const loadMessages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/google/gmail/messages?max=20&q=${encodeURIComponent(query)}`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      setMessages(j.messages || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { void loadStatus() }, [loadStatus])

  async function connectGoogle() {
    const r = await fetch('/api/google/auth/start?scopes=gmail.readonly,calendar.readonly,tasks')
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      setError(j?.error || 'Failed to start OAuth')
      return
    }
    const j = await r.json()
    if (j.url) window.location.href = j.url
  }

  if (!status) return <div className="p-8 text-muted-foreground">Loading…</div>

  if (!status.connected || !status.capabilities.gmail_read) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Connect your personal Google account and grant Gmail read access to use this panel.
        </p>
        {!status.configured && (
          <p className="text-sm text-amber-500">
            Google OAuth client is not configured on the server. See <code>docs/personal-mode.md</code>.
          </p>
        )}
        <Button onClick={() => void connectGoogle()} disabled={!status.configured}>Connect Google</Button>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">Read-only Gmail summaries (cached locally).</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Gmail search query"
            className="rounded-md border bg-background px-3 py-1 text-sm"
          />
          <Button size="sm" onClick={() => void loadMessages()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {error && <div className="text-sm text-red-500">{error}</div>}

      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages loaded. Click <em>Refresh</em>.</p>
      ) : (
        <ul className="divide-y border rounded-lg bg-card">
          {messages.map(m => (
            <li key={m.id} className="p-3">
              <div className="flex justify-between gap-2">
                <span className="font-medium truncate">{m.subject || '(no subject)'}</span>
                <span className="text-xs text-muted-foreground shrink-0">{m.date}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate">{m.from}</div>
              <div className="text-sm mt-1 line-clamp-2">{m.snippet}</div>
              {m.labels?.length > 0 && (
                <div className="mt-1 text-[10px] text-muted-foreground">{m.labels.join(' · ')}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
