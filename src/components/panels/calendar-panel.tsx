'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  startTs: number | null
  location: string
  attendees: Array<{ email: string; name: string; response: string }>
  conferenceUrl: string
  htmlLink: string
}

export function CalendarPanel() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/google/calendar/agenda?days=${days}`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      setEvents(j.events || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load calendar')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { void load() }, [load])

  const grouped = events.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    const key = e.startTs ? new Date(e.startTs * 1000).toDateString() : 'No date'
    if (!acc[key]) acc[key] = []
    acc[key].push(e)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted-foreground">Next {days} day{days === 1 ? '' : 's'} (read-only)</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value={1}>1 day</option>
            <option value={2}>2 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
          </select>
          <Button size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {error && <div className="text-sm text-red-500">{error}</div>}

      {Object.keys(grouped).length === 0 ? (
        <p className="text-sm text-muted-foreground">No events.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([day, items]) => (
            <section key={day} className="rounded-lg border bg-card">
              <h2 className="text-sm font-semibold border-b px-4 py-2">{day}</h2>
              <ul className="divide-y">
                {items.map(e => (
                  <li key={e.id} className="p-3">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{e.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {e.startTs ? new Date(e.startTs * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    {e.location && <div className="text-xs text-muted-foreground">{e.location}</div>}
                    {e.attendees.length > 0 && (
                      <div className="text-xs text-muted-foreground truncate">
                        {e.attendees.length} attendee{e.attendees.length === 1 ? '' : 's'}
                      </div>
                    )}
                    {e.conferenceUrl && (
                      <a href={e.conferenceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                        Join meeting
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
