import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { GOOGLE_SCOPES, getGoogleOAuthConfig, loadTokens } from '@/lib/google-oauth'

/**
 * GET /api/google/auth/status
 * Returns whether the current user has connected Google, with the granted scopes.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const cfg = getGoogleOAuthConfig()
  const tokens = loadTokens(user.id)
  if (!tokens) {
    return NextResponse.json({
      connected: false,
      configured: Boolean(cfg),
      scopes: [],
      capabilities: {},
    })
  }
  const has = (s: string) => tokens.scopes.includes(s)
  return NextResponse.json({
    connected: true,
    configured: Boolean(cfg),
    email: tokens.email,
    scopes: tokens.scopes,
    capabilities: {
      gmail_read: has(GOOGLE_SCOPES.gmailReadonly) || has(GOOGLE_SCOPES.gmailModify),
      gmail_write: has(GOOGLE_SCOPES.gmailModify),
      calendar_read: has(GOOGLE_SCOPES.calendarReadonly) || has(GOOGLE_SCOPES.calendarEvents),
      calendar_write: has(GOOGLE_SCOPES.calendarEvents),
      tasks: has(GOOGLE_SCOPES.tasks),
      drive_read: has(GOOGLE_SCOPES.driveReadonly),
      contacts_read: has(GOOGLE_SCOPES.contactsReadonly),
    },
  })
}
