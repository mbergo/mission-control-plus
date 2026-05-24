'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface BriefingRow {
  id: number
  kind: string
  generated_at: number
  model_used: string | null
  content_md: string
}

export function BriefingsPanel() {
  const [items, setItems] = useState<BriefingRow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/personal/briefings?limit=30')
    if (r.ok) {
      const j = await r.json()
      setItems(j.briefings || [])
      if (j.briefings?.[0]?.id) setSelectedId(j.briefings[0].id)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function generate(kind: 'morning' | 'evening' | 'weekly') {
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
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed')
    } finally {
      setGenerating(false)
    }
  }

  const selected = items.find(i => i.id === selectedId) || null

  return (
    <div className="p-6 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      <aside className="space-y-2">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" onClick={() => void generate('morning')} disabled={generating}>Morning</Button>
          <Button size="sm" variant="outline" onClick={() => void generate('evening')} disabled={generating}>Evening</Button>
          <Button size="sm" variant="outline" onClick={() => void generate('weekly')} disabled={generating}>Weekly</Button>
        </div>
        {error && <div className="text-sm text-red-500">{error}</div>}
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mt-3">Archive</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No briefings yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.map(b => (
              <li key={b.id}>
                <button
                  onClick={() => setSelectedId(b.id)}
                  className={`w-full text-left rounded px-2 py-1 hover:bg-accent ${b.id === selectedId ? 'bg-accent' : ''}`}
                >
                  <div className="font-medium capitalize">{b.kind}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(b.generated_at * 1000).toLocaleString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="rounded-lg border bg-card p-4">
        {selected ? (
          <>
            <div className="flex justify-between mb-2">
              <h1 className="text-xl font-semibold capitalize">{selected.kind} briefing</h1>
              <span className="text-xs text-muted-foreground">{selected.model_used}</span>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={selected.content_md} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select a briefing or generate a new one.</p>
        )}
      </main>
    </div>
  )
}
