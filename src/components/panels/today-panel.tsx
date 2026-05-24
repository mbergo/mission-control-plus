'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface CalendarEventRow {
  event_id: string
  title: string
  start_ts: number | null
  end_ts: number | null
  location: string | null
}
interface GmailThreadRow {
  thread_id: string
  subject: string | null
  from_addr: string | null
  snippet: string | null
  internal_date: number | null
}
interface Briefing {
  id: number
  kind: string
  generated_at: number
  content_md: string
  model_used: string | null
}
interface TodayPayload {
  events: CalendarEventRow[]
  recentThreads: GmailThreadRow[]
  dueFlashcards: number
  journalToday: { id: number; mood: number | null; energy: number | null; chars: number } | null
  latestBriefing: Briefing | null
  queuedReading: Array<{ id: number; title: string; url: string | null; status: string }>
}

function fmtTime(ts: number | null): string {
  if (!ts) return 'TBD'
  return new Date(ts * 1000).toLocaleString(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  })
}

export function TodayPanel() {
  const [data, setData] = useState<TodayPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/personal/today')
      if (r.ok) {
        const j = (await r.json()) as TodayPayload
        setData(j)
        setBriefing(j.latestBriefing)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function refreshSources() {
    setError(null)
    try {
      // Best-effort refresh. Failures (e.g. Google not connected) are non-fatal.
      await Promise.allSettled([
        fetch('/api/google/calendar/agenda?days=2'),
        fetch('/api/google/gmail/messages?q=newer_than:1d&max=10'),
      ])
    } finally {
      void load()
    }
  }

  async function generateBriefing(kind: 'morning' | 'evening' | 'weekly') {
    setGenerating(true)
    setError(null)
    try {
      const r = await fetch('/api/personal/briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      setBriefing({
        id: j.id,
        kind: j.kind,
        generated_at: Math.floor(Date.now() / 1000),
        content_md: j.content_md,
        model_used: j.model_used,
      })
    } catch (e: any) {
      setError(e?.message || 'Failed to generate briefing')
    } finally {
      setGenerating(false)
    }
  }

  if (loading && !data) return <div className="p-8 text-muted-foreground">Loading…</div>

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Today</h1>
          <p className="text-sm text-muted-foreground">{new Date().toDateString()}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refreshSources()}>Refresh from Google</Button>
          <Button size="sm" onClick={() => void generateBriefing('morning')} disabled={generating}>
            {generating ? 'Generating…' : 'Brief me'}
          </Button>
        </div>
      </header>

      {error && <div className="text-sm text-red-500">{error}</div>}

      {briefing && (
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold capitalize">{briefing.kind} briefing</h2>
            <span className="text-xs text-muted-foreground">{briefing.model_used}</span>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownRenderer content={briefing.content_md} />
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold mb-2">Agenda</h2>
          {(!data?.events || data.events.length === 0) ? (
            <p className="text-sm text-muted-foreground">No cached events. Click <em>Refresh from Google</em>.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.events.map(e => (
                <li key={e.event_id} className="flex flex-col">
                  <span className="font-medium">{e.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtTime(e.start_ts)}{e.location ? ` · ${e.location}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold mb-2">Inbox highlights</h2>
          {(!data?.recentThreads || data.recentThreads.length === 0) ? (
            <p className="text-sm text-muted-foreground">No cached threads.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.recentThreads.map(t => (
                <li key={t.thread_id} className="flex flex-col">
                  <span className="font-medium truncate">{t.subject || '(no subject)'}</span>
                  <span className="text-xs text-muted-foreground truncate">{t.from_addr}</span>
                  <span className="text-xs text-muted-foreground line-clamp-2">{t.snippet}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold mb-2">Learning</h2>
          <p className="text-sm">Flashcards due: <strong>{data?.dueFlashcards ?? 0}</strong></p>
          {data?.queuedReading && data.queuedReading.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-medium">Reading queue</p>
              <ul className="mt-1 space-y-1">
                {data.queuedReading.map(r => (
                  <li key={r.id} className="truncate">• {r.title}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold mb-2">Journal</h2>
          {data?.journalToday ? (
            <p className="text-sm">
              Logged today · mood {data.journalToday.mood ?? '—'} · energy {data.journalToday.energy ?? '—'} · {data.journalToday.chars} chars
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No entry yet for today. Open the Journal panel to log mood, energy, and notes.</p>
          )}
        </section>
      </div>
    </div>
  )
}
