import { describe, it, expect, beforeAll } from 'vitest'

// Ensure a stable secret for encryption-roundtrip tests.
process.env.AUTH_SECRET = 'test-secret-for-google-oauth'

import {
  buildAuthorizationUrl,
  buildStateToken,
  decryptSecret,
  encryptSecret,
  generatePkcePair,
  verifyStateToken,
  redactEmail,
} from '../google-oauth'

describe('google-oauth helpers', () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret-for-google-oauth'
  })

  it('generates an RFC 7636 compliant PKCE pair', () => {
    const { verifier, challenge } = generatePkcePair()
    // base64url charset, no padding
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier).not.toBe(challenge)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
  })

  it('round-trips encrypted secrets', () => {
    const secret = 'ya29.fake-access-token-' + 'x'.repeat(50)
    const enc = encryptSecret(secret)
    expect(enc).toMatch(/^v1\./)
    expect(enc).not.toContain(secret)
    expect(decryptSecret(enc)).toBe(secret)
  })

  it('fails decryption on tampered payload', () => {
    const enc = encryptSecret('hello')
    const tampered = enc.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('builds an authorization URL with required OAuth parameters', () => {
    const url = buildAuthorizationUrl({
      clientId: 'CID',
      redirectUri: 'http://localhost:3000/api/google/auth/callback',
      scopes: ['openid', 'https://www.googleapis.com/auth/gmail.readonly'],
      state: 'STATE',
      codeChallenge: 'CHAL',
    })
    expect(url).toContain('client_id=CID')
    expect(url).toContain('code_challenge=CHAL')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('access_type=offline')
    expect(url).toContain('gmail.readonly')
  })

  it('verifies its own state tokens and rejects forgery', () => {
    const { verifier } = generatePkcePair()
    const token = buildStateToken(42, verifier)
    const verified = verifyStateToken(token)
    expect(verified).toEqual({ userId: 42, verifier })
    expect(verifyStateToken(token + 'x')).toBeNull()
    expect(verifyStateToken('totally-bogus')).toBeNull()
  })

  it('redacts emails for audit logs', () => {
    expect(redactEmail('alice@gmail.com')).toBe('a****@gmail.com')
    expect(redactEmail(null)).toBe('')
    expect(redactEmail('not-an-email')).toBe('')
  })
})
