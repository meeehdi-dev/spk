import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../server/db/client'
import { createInvite } from '../server/db/invites'
import { invites, session, user } from '../server/db/schema'

// better-auth's own admin endpoints bypass the app's rules (last admin, impersonation, invite-only), so the before hook blocks them all.
// useAuth() is a singleton bound to the first db, so both suites share this setup.
let useAuth: typeof import('../server/utils/auth').useAuth
let requireUser: typeof import('../server/utils/session').requireUser
let db: Db
beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-123'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  db = createDb(':memory:')
  vi.stubGlobal('useDb', () => db)
  vi.stubGlobal('useAuth', () => useAuth())
  vi.stubGlobal('createError', (o: object) => Object.assign(new Error('http'), o))
  ;({ useAuth } = await import('../server/utils/auth'))
  ;({ requireUser } = await import('../server/utils/session'))
})
afterAll(() => vi.unstubAllGlobals())

describe('better-auth admin endpoints', () => {

  for (const p of ['update-user', 'impersonate-user', 'create-user', 'set-role', 'ban-user', 'remove-user', 'set-user-password']) {
    it(`/admin/${p} → 403`, async () => {
      const res = await useAuth().handler(new Request(`http://localhost:3000/api/auth/admin/${p}`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: '{}'
      }))
      expect(res.status).toBe(403)
    })
  }
})

describe('sign-up and sign-in through the handler', () => {
  const post = (path: string, body: object, token?: string) => useAuth().handler(new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(token ? { 'x-invite-token': token } : {}) },
    body: JSON.stringify(body)
  }))
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

  it('requireUser forwards the refreshed session cookie once the session is older than updateAge', async () => {
    const res = await post('/sign-in/email', { email: creds.email, password: creds.password })
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    db.update(session).set({ expiresAt: new Date(Date.now() + 10 * 86_400_000) }).run() // every session, so the one in the cookie is included
    const cookies: string[] = []
    vi.stubGlobal('appendResponseHeader', (_e: unknown, name: string, v: string) => { if (name === 'set-cookie') cookies.push(v) })
    const u = await requireUser({ headers: new Headers({ cookie }), context: {} } as never)
    expect(u.email).toBe(creds.email)
    expect(cookies.some(c => c.includes('session_token'))).toBe(true)
  })

  it('banned user sign-in → 403 BANNED_USER', async () => {
    db.update(user).set({ banned: true }).where(eq(user.email, creds.email)).run()
    const res = await post('/sign-in/email', { email: creds.email, password: creds.password })
    expect(res.status).toBe(403)
    expect((await res.json() as { code: string }).code).toBe('BANNED_USER')
  })
})
