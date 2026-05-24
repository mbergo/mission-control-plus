import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { GOOGLE_SCOPES, googleApiFetch, hasScope, loadTokens } from '@/lib/google-oauth'
import { logAuditEvent } from '@/lib/db'

/**
 * GET /api/google/drive/files?q=…&max=20
 * Searches the user's Drive (read-only).
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
  if (!hasScope(tokens, GOOGLE_SCOPES.driveReadonly)) {
    return NextResponse.json({ error: 'Missing drive.readonly scope' }, { status: 403 })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q') || ''
  const max = Math.min(Math.max(parseInt(url.searchParams.get('max') || '20', 10), 1), 50)
  const driveQuery = q
    ? `name contains '${q.replace(/'/g, "\\'")}' and trashed = false`
    : `trashed = false`

  const apiUrl = `https://www.googleapis.com/drive/v3/files?` +
    `pageSize=${max}&q=${encodeURIComponent(driveQuery)}` +
    `&fields=files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))`

  const res = await googleApiFetch(user.id, apiUrl)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    return NextResponse.json({ error: 'Drive list failed', detail: txt.slice(0, 200) }, { status: res.status })
  }
  const json = await res.json() as { files?: any[] }

  logAuditEvent({
    action: 'google_drive_search',
    actor: user.username,
    actor_id: user.id,
    detail: { q, count: (json.files || []).length },
  })

  return NextResponse.json({ files: json.files || [] })
}
