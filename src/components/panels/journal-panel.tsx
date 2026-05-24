'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface JournalEntry {
  id: number
  entry_date: string
  mood: number | null
  energy: number | null
  content_md: string
  created_at: number
  updated_at: number
}

function isoDate(d = new Date()): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function JournalPanel() {
  const [date, setDate] = useState<string>(isoDate())
  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [content, setContent] = useState('')
  const [mood, setMood] = useState<number | ''>('')
  const [energy, setEnergy] = useState<number | ''>('')
  const [list, setList] = useState<Array<{ id: number; entry_date: string; mood: number | null; energy: number | null; chars: number }>>([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const loadEntry = useCallback(async (d: string) => {
    const r = await fetch(`/api/personal/journal?date=${d}`)
    if (r.ok) {
      const j = await r.json()
      const e = j.entry as JournalEntry | null
      setEntry(e)
      setContent(e?.content_md ?? '')
      setMood(e?.mood ?? '')
      setEnergy(e?.energy ?? '')
    }
  }, [])

  const loadList = useCallback(async () => {
    const r = await fetch('/api/personal/journal?list=1&limit=20')
    if (r.ok) {
      const j = await r.json()
      setList(j.entries || [])
    }
  }, [])

  useEffect(() => { void loadEntry(date); void loadList() }, [date, loadEntry, loadList])

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/personal/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          content_md: content,
          mood: mood === '' ? null : Number(mood),
          energy: energy === '' ? null : Number(energy),
        }),
      })
      setSavedAt(Date.now())
      void loadList()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_280px] gap-6">
      <div className="space-y-3">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Journal</h1>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
        </header>

        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            Mood
            <select value={mood} onChange={e => setMood(e.target.value === '' ? '' : Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1">
              <option value="">—</option>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Energy
            <select value={energy} onChange={e => setEnergy(e.target.value === '' ? '' : Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1">
              <option value="">—</option>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={20}
          placeholder="What happened today? What did you learn? What's tomorrow's focus?"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
        />
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          {savedAt && <span className="text-xs text-muted-foreground">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
          {entry && <span className="text-xs text-muted-foreground">Last updated {new Date(entry.updated_at * 1000).toLocaleString()}</span>}
        </div>
      </div>

      <aside className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">Recent</h2>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {list.map(e => (
              <li key={e.id}>
                <button
                  className={`w-full text-left rounded px-2 py-1 hover:bg-accent ${e.entry_date === date ? 'bg-accent' : ''}`}
                  onClick={() => setDate(e.entry_date)}
                >
                  <div className="font-medium">{e.entry_date}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.mood ? `mood ${e.mood}` : ''} {e.energy ? `· energy ${e.energy}` : ''} · {e.chars} chars
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}
