import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { deleteTokens, revokeToken } from '@/lib/google-oauth'
import { logAuditEvent } from '@/lib/db'

/**
 * POST /api/google/auth/disconnect
 * Revokes the access/refresh token with Google and deletes the local row.
 */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const tokens = deleteTokens(user.id)
  if (tokens) {
    // Revoke best-effort. Prefer refresh token (revokes both); else access token.
    await revokeToken(tokens.refreshToken || tokens.accessToken)
  }
  logAuditEvent({
    action: 'google_oauth_disconnected',
    actor: user.username,
    actor_id: user.id,
  })
  return NextResponse.json({ ok: true })
}
