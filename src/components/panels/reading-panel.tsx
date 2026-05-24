'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface ReadingSource {
  id: number
  kind: 'url' | 'drive' | 'upload'
  title: string
  url: string | null
  status: 'queued' | 'reading' | 'done'
  added_at: number
  notes: string | null
}

interface Flashcard {
  id: number
  source_id: number | null
  front: string
  back: string
  ease: number
  interval_days: number
  due_at: number
  reviewed_count: number
}

export function ReadingPanel() {
  const [sources, setSources] = useState<ReadingSource[]>([])
  const [filter, setFilter] = useState<'all' | 'queued' | 'reading' | 'done'>('all')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dueCards, setDueCards] = useState<Flashcard[]>([])
  const [cardIdx, setCardIdx] = useState(0)
  const [showBack, setShowBack] = useState(false)
  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')

  const load = useCallback(async () => {
    const r = await fetch(`/api/personal/reading${filter === 'all' ? '' : `?status=${filter}`}`)
    if (r.ok) {
      const j = await r.json()
      setSources(j.sources || [])
    }
    const r2 = await fetch('/api/personal/flashcards?due=1')
    if (r2.ok) {
      const j2 = await r2.json()
      setDueCards(j2.flashcards || [])
      setCardIdx(0)
      setShowBack(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])

  async function addSource() {
    if (!title.trim()) return
    setError(null)
    const r = await fetch('/api/personal/reading', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: url ? 'url' : 'url', title: title.trim(), url: url.trim() || null }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      setError(j?.error || 'Failed to add')
      return
    }
    setTitle(''); setUrl('')
    void load()
  }

  async function updateStatus(id: number, status: ReadingSource['status']) {
    await fetch('/api/personal/reading', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    void load()
  }

  async function deleteSource(id: number) {
    await fetch(`/api/personal/reading?id=${id}`, { method: 'DELETE' })
    void load()
  }

  async function addCard() {
    if (!newFront.trim() || !newBack.trim()) return
    await fetch('/api/personal/flashcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ front: newFront.trim(), back: newBack.trim() }),
    })
    setNewFront(''); setNewBack('')
    void load()
  }

  async function rateCard(quality: number) {
    const card = dueCards[cardIdx]
    if (!card) return
    await fetch('/api/personal/flashcards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: card.id, quality }),
    })
    setShowBack(false)
    if (cardIdx + 1 >= dueCards.length) {
      void load()
    } else {
      setCardIdx(cardIdx + 1)
    }
  }

  const currentCard = dueCards[cardIdx]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Reading & Study</h1>
        <p className="text-sm text-muted-foreground">Reading queue, highlights, and spaced-repetition flashcards.</p>
      </header>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-lg font-semibold">Add to reading queue</h2>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
            className="rounded-md border bg-background px-3 py-1 text-sm flex-1"
          />
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="URL (optional)"
            className="rounded-md border bg-background px-3 py-1 text-sm flex-1"
          />
          <Button size="sm" onClick={() => void addSource()}>Add</Button>
        </div>
        {error && <div className="text-sm text-red-500">{error}</div>}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 className="text-lg font-semibold">Reading queue</h2>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as any)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="queued">Queued</option>
            <option value="reading">Reading</option>
            <option value="done">Done</option>
          </select>
        </div>
        {sources.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Empty.</p>
        ) : (
          <ul className="divide-y">
            {sources.map(s => (
              <li key={s.id} className="p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{s.title}</div>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-primary truncate block">
                      {s.url}
                    </a>
                  )}
                </div>
                <select
                  value={s.status}
                  onChange={e => updateStatus(s.id, e.target.value as ReadingSource['status'])}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <option value="queued">Queued</option>
                  <option value="reading">Reading</option>
                  <option value="done">Done</option>
                </select>
                <Button variant="ghost" size="sm" onClick={() => void deleteSource(s.id)}>Delete</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-lg font-semibold">Flashcards · {dueCards.length} due</h2>
        {currentCard ? (
          <div className="rounded-md border p-4 space-y-3">
            <div className="text-sm text-muted-foreground">Card {cardIdx + 1} of {dueCards.length}</div>
            <div className="text-lg font-medium whitespace-pre-wrap">{currentCard.front}</div>
            {showBack && (
              <div className="text-sm whitespace-pre-wrap border-t pt-3">{currentCard.back}</div>
            )}
            {!showBack ? (
              <Button onClick={() => setShowBack(true)}>Show answer</Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void rateCard(1)}>Again</Button>
                <Button variant="outline" size="sm" onClick={() => void rateCard(3)}>Hard</Button>
                <Button size="sm" onClick={() => void rateCard(4)}>Good</Button>
                <Button size="sm" onClick={() => void rateCard(5)}>Easy</Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No cards due. Add one below.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <textarea
            value={newFront}
            onChange={e => setNewFront(e.target.value)}
            placeholder="Front"
            className="rounded-md border bg-background px-3 py-1 text-sm"
            rows={2}
          />
          <textarea
            value={newBack}
            onChange={e => setNewBack(e.target.value)}
            placeholder="Back"
            className="rounded-md border bg-background px-3 py-1 text-sm"
            rows={2}
          />
        </div>
        <Button size="sm" onClick={() => void addCard()}>Add flashcard</Button>
      </section>
    </div>
  )
}
