import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createDb, type Db } from '~~/server/db/client'
import { createInvite } from '~~/server/db/invites'
import { session } from '~~/server/db/schema'

let useAuth: typeof import('~~/server/utils/auth').useAuth
let requireUser: typeof import('~~/server/utils/session').requireUser
let db: Db
beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-123'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  db = createDb(':memory:')
  vi.stubGlobal('useDb', () => db)
  vi.stubGlobal('useAuth', () => useAuth())
  vi.stubGlobal('createError', (o: object) => Object.assign(new Error('http'), o))
  ;({ useAuth } = await import('~~/server/utils/auth'))
  ;({ requireUser } = await import('~~/server/utils/session'))
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

describe('requireUser', () => {
  it('forwards the refreshed session cookie once the session is older than updateAge', async () => {
    const creds = { email: 'first@x.dev', password: 'password-123', name: 'First' }
    await post('/sign-up/email', creds, createInvite(db, { createdBy: null }).token)
    const res = await post('/sign-in/email', { email: creds.email, password: creds.password })
    const cookie = res.headers
      .getSetCookie()
      .map(c => c.split(';')[0])
      .join('; ')
    db.update(session)
      .set({ expiresAt: new Date(Date.now() + 10 * 86_400_000) })
      .run() // every session, so the one in the cookie is included
    const cookies: string[] = []
    vi.stubGlobal('appendResponseHeader', (_e: unknown, name: string, v: string) => {
      if (name === 'set-cookie') cookies.push(v)
    })
    const u = await requireUser({ headers: new Headers({ cookie }), context: {} } as never)
    expect(u.email).toBe(creds.email)
    expect(cookies.some(c => c.includes('session_token'))).toBe(true)
  })
})
