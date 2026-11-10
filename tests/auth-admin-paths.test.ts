import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb } from '../server/db/client'

// better-auth's own admin endpoints bypass the app's rules (last admin, impersonation, invite-only), so the before hook blocks them all.
describe('better-auth admin endpoints', () => {
  let useAuth: typeof import('../server/utils/auth').useAuth
  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-123'
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    const db = createDb(':memory:')
    vi.stubGlobal('useDb', () => db)
    ;({ useAuth } = await import('../server/utils/auth'))
  })
  afterAll(() => vi.unstubAllGlobals())

  for (const p of ['update-user', 'impersonate-user', 'create-user', 'set-role', 'ban-user', 'remove-user', 'set-user-password']) {
    it(`/admin/${p} → 403`, async () => {
      const res = await useAuth().handler(new Request(`http://localhost:3000/api/auth/admin/${p}`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: '{}'
      }))
      expect(res.status).toBe(403)
    })
  }
})
