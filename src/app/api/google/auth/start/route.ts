import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import {
  DEFAULT_PERSONAL_SCOPES,
  GOOGLE_SCOPES,
  buildAuthorizationUrl,
  buildStateToken,
  generatePkcePair,
  getGoogleOAuthConfig,
} from '@/lib/google-oauth'
import { logAuditEvent } from '@/lib/db'

/**
 * GET /api/google/auth/start
 * Optional query: ?scopes=gmail.readonly,calendar.readonly,tasks,...
 * Returns the consent URL the client should redirect to.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const cfg = getGoogleOAuthConfig()
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          'Google OAuth client is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI.',
      },
      { status: 503 }
    )
  }

  const url = new URL(request.url)
  const requestedScopes = String(url.searchParams.get('scopes') || '').split(',').map(s => s.trim()).filter(Boolean)
  const aliasMap: Record<string, string> = {
    'gmail.readonly': GOOGLE_SCOPES.gmailReadonly,
    'gmail.modify': GOOGLE_SCOPES.gmailModify,
    'calendar.readonly': GOOGLE_SCOPES.calendarReadonly,
    'calendar.events': GOOGLE_SCOPES.calendarEvents,
    tasks: GOOGLE_SCOPES.tasks,
    'drive.readonly': GOOGLE_SCOPES.driveReadonly,
    'documents.readonly': GOOGLE_SCOPES.documentsReadonly,
    'contacts.readonly': GOOGLE_SCOPES.contactsReadonly,
  }
  const resolvedScopes = requestedScopes.length
    ? Array.from(new Set([
        GOOGLE_SCOPES.openid, GOOGLE_SCOPES.email, GOOGLE_SCOPES.profile,
        ...requestedScopes.map(s => aliasMap[s] || s),
      ]))
    : DEFAULT_PERSONAL_SCOPES

  const { verifier, challenge } = generatePkcePair()
  const state = buildStateToken(user.id, verifier)
  const authUrl = buildAuthorizationUrl({
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    scopes: resolvedScopes,
    state,
    codeChallenge: challenge,
  })

  logAuditEvent({
    action: 'google_oauth_start',
    actor: user.username,
    actor_id: user.id,
    detail: JSON.stringify({ scopes: resolvedScopes }),
  })

  return NextResponse.json({ url: authUrl, scopes: resolvedScopes })
}
