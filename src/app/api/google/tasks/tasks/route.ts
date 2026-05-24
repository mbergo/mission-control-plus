import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { GOOGLE_SCOPES, googleApiFetch, hasScope, loadTokens } from '@/lib/google-oauth'
import { logAuditEvent } from '@/lib/db'

interface GTaskList { id: string; title: string }
interface GTask {
  id: string
  title?: string
  notes?: string
  status?: string
  due?: string
  completed?: string
  updated?: string
}

/**
 * GET /api/google/tasks/tasks
 * Returns open tasks across the user's task lists.
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
  if (!hasScope(tokens, GOOGLE_SCOPES.tasks)) {
    return NextResponse.json({ error: 'Missing tasks scope' }, { status: 403 })
  }

  const listsRes = await googleApiFetch(user.id, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists')
  if (!listsRes.ok) {
    const txt = await listsRes.text().catch(() => '')
    return NextResponse.json({ error: 'Tasks lists failed', detail: txt.slice(0, 200) }, { status: listsRes.status })
  }
  const listsJson = await listsRes.json() as { items?: GTaskList[] }
  const lists = listsJson.items || []

  const results: Array<{ listId: string; listTitle: string; tasks: any[] }> = []
  for (const l of lists) {
    const r = await googleApiFetch(
      user.id,
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks?showCompleted=false&maxResults=100`,
    )
    if (!r.ok) continue
    const j = await r.json() as { items?: GTask[] }
    results.push({
      listId: l.id,
      listTitle: l.title,
      tasks: (j.items || []).map(t => ({
        id: t.id,
        title: t.title || '',
        notes: t.notes || '',
        status: t.status || '',
        due: t.due || '',
        updated: t.updated || '',
      })),
    })
  }

  logAuditEvent({
    action: 'google_tasks_list',
    actor: user.username,
    actor_id: user.id,
    detail: { lists: results.length, count: results.reduce((s, x) => s + x.tasks.length, 0) },
  })

  return NextResponse.json({ lists: results })
}
