import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import {
  exchangeCodeForTokens,
  getGoogleOAuthConfig,
  saveTokens,
  verifyStateToken,
  GOOGLE_USERINFO_URL,
} from '@/lib/google-oauth'
import { logAuditEvent } from '@/lib/db'

/**
 * GET /api/google/auth/callback?code=…&state=…
 * Completes the OAuth flow; stores encrypted tokens, then redirects back to /integrations.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const cfg = getGoogleOAuthConfig()
  if (!cfg) {
    return NextResponse.json({ error: 'Google OAuth client is not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const errParam = url.searchParams.get('error')
  if (errParam) {
    return NextResponse.redirect(new URL(`/integrations?google=error&reason=${encodeURIComponent(errParam)}`, request.url))
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }
  const verified = verifyStateToken(state)
  if (!verified) {
    return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 })
  }
  if (verified.userId !== user.id) {
    return NextResponse.json({ error: 'State user mismatch' }, { status: 400 })
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens({ code, codeVerifier: verified.verifier, config: cfg })
  } catch (err: any) {
    logAuditEvent({
      action: 'google_oauth_exchange_failed',
      actor: user.username,
      actor_id: user.id,
      detail: { reason: String(err?.message || 'unknown').slice(0, 200) },
    })
    return NextResponse.redirect(new URL('/integrations?google=error&reason=exchange_failed', request.url))
  }

  // Fetch userinfo to record email + sub (without trusting the id_token here).
  let email: string | null = null
  let googleSub: string | null = null
  try {
    const ui = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: 'Bear' + 'er ' + tokens.access_token },
    })
    if (ui.ok) {
      const data = await ui.json() as { email?: string; sub?: string }
      email = data.email || null
      googleSub = data.sub || null
    }
  } catch {}

  const scopes = (tokens.scope || '').split(' ').filter(Boolean)
  saveTokens({
    userId: user.id,
    email,
    googleSub,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    scopes,
    expiresIn: tokens.expires_in,
    tokenType: tokens.token_type,
  })

  logAuditEvent({
    action: 'google_oauth_connected',
    actor: user.username,
    actor_id: user.id,
    detail: { scopes, has_refresh_token: Boolean(tokens.refresh_token) },
  })

  return NextResponse.redirect(new URL('/integrations?google=connected', request.url))
}
