import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createDb, type Db } from '~~/server/db/client'
import { createInvite } from '~~/server/db/invites'
import { invites, user } from '~~/server/db/schema'

// better-auth's own admin endpoints bypass the app's rules (last admin, impersonation, invite-only), so the before hook blocks them all.
// useAuth() is a singleton bound to the first db, so both suites share this setup.
let useAuth: typeof import('~~/server/utils/auth').useAuth
let db: Db
beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-123'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  db = createDb(':memory:')
  vi.stubGlobal('useDb', () => db)
  ;({ useAuth } = await import('~~/server/utils/auth'))
})
afterAll(() => vi.unstubAllGlobals())

const post = (path: string, body: object, token?: string) =>
  useAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(token ? { 'x-invite-token': token } : {}) },
      body: JSON.stringify(body),
    }),
  )

describe('better-auth admin endpoints', () => {
  for (const p of ['update-user', 'impersonate-user', 'create-user', 'set-role', 'ban-user', 'remove-user', 'set-user-password']) {
    it(`/admin/${p} → 403`, async () => {
      expect((await post(`/admin/${p}`, {})).status).toBe(403)
    })
  }
})

describe('sign-up and sign-in through the handler', () => {
  const creds = { email: 'first@x.dev', password: 'password-123', name: 'First' }

  it('sign-up without an invite → 403', async () => {
    expect((await post('/sign-up/email', creds)).status).toBe(403)
    expect(db.select().from(user).all()).toHaveLength(0)
  })

  it('sign-up with the system invite → admin, invite linked', async () => {
    const { token } = createInvite(db, { createdBy: null })
    const res = await post('/sign-up/email', creds, token)
    expect(res.status).toBe(200)
    const u = db.select().from(user).get()!
    expect(u.role).toBe('admin')
    expect(db.select().from(invites).get()!.usedBy).toBe(u.id)
  })

  it('a used invite cannot sign up again', async () => {
    const { token } = createInvite(db, { createdBy: null })
    await post('/sign-up/email', { ...creds, email: 'dup@x.dev' }, token)
    expect((await post('/sign-up/email', { ...creds, email: 'dup2@x.dev' }, token)).status).toBe(403)
  })

  it('banned user sign-in → 403 BANNED_USER', async () => {
    db.update(user).set({ banned: true }).where(eq(user.email, creds.email)).run()
    const res = await post('/sign-in/email', { email: creds.email, password: creds.password })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('BANNED_USER')
  })
})

describe('development tunnel origin', () => {
  // The nuxt.config listen hook sets BETTER_AUTH_URL to the tunnel origin; a fresh auth instance picks it up.
  it('allows authentication and session cookies on the tunnel but rejects another origin', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('BETTER_AUTH_URL', 'https://active.trycloudflare.com')
    const tunnelDb = createDb(':memory:')
    vi.stubGlobal('useDb', () => tunnelDb)
    vi.resetModules()
    try {
      const auth = (await import('~~/server/utils/auth')).useAuth()
      // Better Auth skips origin checks in test mode; enable them for this regression test.
      ;(await auth.$context).skipOriginCheck = false
      const { token } = createInvite(tunnelDb, { createdBy: null })
      const res = await auth.handler(
        new Request('https://active.trycloudflare.com/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://active.trycloudflare.com', 'x-invite-token': token },
          body: JSON.stringify({ email: 'tunnel@example.com', password: 'password-123', name: 'Tunnel' }),
        }),
      )
      expect(res.status).toBe(200)
      const cookies = res.headers.getSetCookie()
      expect(cookies.some(cookie => /session_token=.*;.*Secure/i.test(cookie))).toBe(true)
      const session = await auth.api.getSession({ headers: new Headers({ cookie: cookies.map(cookie => cookie.split(';')[0]).join('; ') }) })
      expect(session?.user.email).toBe('tunnel@example.com')
      const rejected = await auth.handler(
        new Request('https://active.trycloudflare.com/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://other.trycloudflare.com' },
          body: JSON.stringify({ email: 'tunnel@example.com', password: 'password-123' }),
        }),
      )
      expect(rejected.status).toBe(403)
    } finally {
      vi.unstubAllEnvs()
      tunnelDb.$client.close()
    }
  })
})
