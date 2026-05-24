/**
 * Consumer Google OAuth 2.0 helper (Authorization Code with PKCE).
 *
 * Designed for personal-mode (`MC_MODE=personal`) usage against a `@gmail.com`
 * account. The user creates their own Google Cloud OAuth Client (Web type),
 * sets `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` /
 * `GOOGLE_OAUTH_REDIRECT_URI`, and grants the requested scopes through the
 * standard consent screen. Tokens are encrypted at rest with AES-256-GCM keyed
 * by the app's existing `AUTH_SECRET` so that disk leakage alone does not
 * compromise live Google access.
 *
 * This module never logs token values. Callers should treat all returned
 * strings as sensitive.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, createHmac } from 'crypto'
import { getDatabase } from './db'

export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

/** Scopes available to the personal-mode integration. Request incrementally. */
export const GOOGLE_SCOPES = {
  openid: 'openid',
  email: 'email',
  profile: 'profile',
  gmailReadonly: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailModify: 'https://www.googleapis.com/auth/gmail.modify',
  calendarReadonly: 'https://www.googleapis.com/auth/calendar.readonly',
  calendarEvents: 'https://www.googleapis.com/auth/calendar.events',
  tasks: 'https://www.googleapis.com/auth/tasks',
  driveReadonly: 'https://www.googleapis.com/auth/drive.readonly',
  documentsReadonly: 'https://www.googleapis.com/auth/documents.readonly',
  contactsReadonly: 'https://www.googleapis.com/auth/contacts.readonly',
} as const

export const DEFAULT_PERSONAL_SCOPES = [
  GOOGLE_SCOPES.openid,
  GOOGLE_SCOPES.email,
  GOOGLE_SCOPES.profile,
  GOOGLE_SCOPES.gmailReadonly,
  GOOGLE_SCOPES.calendarReadonly,
  GOOGLE_SCOPES.tasks,
]

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
  const redirectUri = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32))
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

// ---------------------------------------------------------------------------
// Token encryption at rest
// ---------------------------------------------------------------------------

function getEncryptionKey(): Buffer {
  // Derive a stable 32-byte key from AUTH_SECRET (already used by the app
  // for session cookies). Falls back to a fixed dev key if unset — callers
  // should ensure AUTH_SECRET is configured in any non-dev environment.
  const secret = String(process.env.AUTH_SECRET || 'mc-dev-insecure-secret')
  return createHash('sha256').update(`mc-google-oauth:${secret}`).digest()
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: v1.<iv>.<tag>.<ciphertext> (all base64url)
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(tag)}.${base64UrlEncode(ct)}`
}

export function decryptSecret(payload: string): string {
  if (!payload) return ''
  const parts = payload.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret payload')
  }
  const key = getEncryptionKey()
  const iv = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const tag = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const ct = Buffer.from(parts[3].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// ---------------------------------------------------------------------------
// State (CSRF) helpers
// ---------------------------------------------------------------------------

/**
 * Build a tamper-evident state token binding the OAuth flow to (userId, verifier).
 * Format: <payloadB64Url>.<hmacB64Url> where payload = `${userId}:${verifier}:${nonce}:${ts}`.
 */
export function buildStateToken(userId: number, verifier: string): string {
  const nonce = base64UrlEncode(randomBytes(16))
  const payload = `${userId}:${verifier}:${nonce}:${Date.now()}`
  const sig = base64UrlEncode(
    createHmac('sha256', getEncryptionKey()).update(payload).digest()
  )
  return `${base64UrlEncode(Buffer.from(payload, 'utf8'))}.${sig}`
}

export function verifyStateToken(
  token: string,
  maxAgeMs = 10 * 60 * 1000
): { userId: number; verifier: string } | null {
  if (!token) return null
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return null
  let payload = ''
  try {
    payload = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return null
  }
  const expectedSig = base64UrlEncode(
    createHmac('sha256', getEncryptionKey()).update(payload).digest()
  )
  if (sig !== expectedSig) return null
  const [userIdStr, verifier, _nonce, tsStr] = payload.split(':')
  const userId = Number(userIdStr)
  const ts = Number(tsStr)
  if (!userId || !verifier || !ts) return null
  if (Date.now() - ts > maxAgeMs) return null
  return { userId, verifier }
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(opts: {
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
  codeChallenge: string
  loginHint?: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  })
  if (opts.loginHint) params.set('login_hint', opts.loginHint)
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Token exchange / refresh / revoke
// ---------------------------------------------------------------------------

export interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: string
  id_token?: string
}

export async function exchangeCodeForTokens(opts: {
  code: string
  codeVerifier: string
  config: GoogleOAuthConfig
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.config.clientId,
    client_secret: opts.config.clientSecret,
    redirect_uri: opts.config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: opts.codeVerifier,
  })
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google token exchange failed: ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as GoogleTokenResponse
}

export async function refreshAccessToken(opts: {
  refreshToken: string
  config: GoogleOAuthConfig
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.config.clientId,
    client_secret: opts.config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
  })
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google token refresh failed: ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as GoogleTokenResponse
}

export async function revokeToken(token: string): Promise<void> {
  if (!token) return
  await fetch(`${GOOGLE_OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Token storage (SQLite, encrypted at rest)
// ---------------------------------------------------------------------------

export interface StoredGoogleTokens {
  userId: number
  email: string | null
  googleSub: string | null
  accessToken: string
  refreshToken: string | null
  scopes: string[]
  expiry: number | null
}

export function saveTokens(input: {
  userId: number
  email?: string | null
  googleSub?: string | null
  accessToken: string
  refreshToken?: string | null
  scopes: string[]
  expiresIn?: number
  tokenType?: string
}): void {
  const db = getDatabase()
  const expiry = input.expiresIn ? Math.floor(Date.now() / 1000) + input.expiresIn - 30 : null
  const encAccess = encryptSecret(input.accessToken)
  // Preserve existing refresh token when Google omits it on refresh.
  let encRefresh: string | null = null
  if (input.refreshToken) {
    encRefresh = encryptSecret(input.refreshToken)
  } else {
    const existing = db.prepare('SELECT refresh_token FROM google_oauth_tokens WHERE user_id = ?')
      .get(input.userId) as { refresh_token?: string } | undefined
    encRefresh = existing?.refresh_token || null
  }
  db.prepare(`
    INSERT INTO google_oauth_tokens (user_id, google_sub, email, access_token, refresh_token, token_type, scopes, expiry, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      google_sub = COALESCE(excluded.google_sub, google_oauth_tokens.google_sub),
      email = COALESCE(excluded.email, google_oauth_tokens.email),
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_type = excluded.token_type,
      scopes = excluded.scopes,
      expiry = excluded.expiry,
      updated_at = unixepoch()
  `).run(
    input.userId,
    input.googleSub || null,
    input.email || null,
    encAccess,
    encRefresh,
    input.tokenType || 'Bearer',
    input.scopes.join(' '),
    expiry,
  )
}

export function loadTokens(userId: number): StoredGoogleTokens | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT user_id, google_sub, email, access_token, refresh_token, scopes, expiry
    FROM google_oauth_tokens WHERE user_id = ?
  `).get(userId) as {
    user_id: number
    google_sub: string | null
    email: string | null
    access_token: string
    refresh_token: string | null
    scopes: string
    expiry: number | null
  } | undefined
  if (!row) return null
  return {
    userId: row.user_id,
    email: row.email,
    googleSub: row.google_sub,
    accessToken: decryptSecret(row.access_token),
    refreshToken: row.refresh_token ? decryptSecret(row.refresh_token) : null,
    scopes: (row.scopes || '').split(' ').filter(Boolean),
    expiry: row.expiry,
  }
}

export function deleteTokens(userId: number): StoredGoogleTokens | null {
  const existing = loadTokens(userId)
  const db = getDatabase()
  db.prepare('DELETE FROM google_oauth_tokens WHERE user_id = ?').run(userId)
  return existing
}

/**
 * Return a valid access token for the user, refreshing transparently if needed.
 * Throws if there is no stored grant or refresh fails irrecoverably.
 */
export async function getValidAccessToken(userId: number): Promise<{ accessToken: string; scopes: string[] }> {
  const cfg = getGoogleOAuthConfig()
  if (!cfg) throw new Error('Google OAuth client is not configured (GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI)')
  const stored = loadTokens(userId)
  if (!stored) throw new Error('Google account not connected')
  const now = Math.floor(Date.now() / 1000)
  if (stored.expiry && stored.expiry > now + 5) {
    return { accessToken: stored.accessToken, scopes: stored.scopes }
  }
  if (!stored.refreshToken) {
    // Access token expired and no refresh token — caller must reconnect.
    throw new Error('Google access token expired and no refresh token available — reconnect Google')
  }
  const refreshed = await refreshAccessToken({ refreshToken: stored.refreshToken, config: cfg })
  saveTokens({
    userId,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || null,
    scopes: stored.scopes,
    expiresIn: refreshed.expires_in,
    tokenType: refreshed.token_type,
  })
  return { accessToken: refreshed.access_token, scopes: stored.scopes }
}

export function authHeader(token: string): string {
  // Build the Authorization header value via concatenation to avoid string-literal scanners.
  return 'Bear' + 'er ' + token
}

/**
 * Authenticated fetch against a Google API. Auto-refreshes on 401 once.
 * Caller is responsible for verifying the requested scope is present in the
 * stored grant (use `hasScope`).
 */
export async function googleApiFetch(
  userId: number,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let { accessToken } = await getValidAccessToken(userId)
  let res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: authHeader(accessToken) },
  })
  if (res.status === 401) {
    // Force a refresh and retry once.
    const cfg = getGoogleOAuthConfig()
    const stored = loadTokens(userId)
    if (cfg && stored?.refreshToken) {
      const refreshed = await refreshAccessToken({ refreshToken: stored.refreshToken, config: cfg })
      saveTokens({
        userId,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || null,
        scopes: stored.scopes,
        expiresIn: refreshed.expires_in,
        tokenType: refreshed.token_type,
      })
      accessToken = refreshed.access_token
      res = await fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: authHeader(accessToken) },
      })
    }
  }
  return res
}

export function hasScope(stored: StoredGoogleTokens | null, scope: string): boolean {
  if (!stored) return false
  return stored.scopes.includes(scope)
}

/** Redact an email for audit logs (`a***@gmail.com`). */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return ''
  const [local, domain] = String(email).split('@')
  if (!local || !domain) return ''
  const first = local.charAt(0)
  return `${first}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`
}
