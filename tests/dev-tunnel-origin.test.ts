import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDb } from '../server/db/client'
import { createInvite } from '../server/db/invites'
import { appOrigin } from '../server/utils/appOrigin'
import { isSameOrigin } from '../server/utils/sameOrigin'

let config: typeof import('../nuxt.config').default
beforeAll(async () => {
  vi.stubGlobal('defineNuxtConfig', (value: unknown) => value)
  config = (await import('../nuxt.config')).default
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function listen(urls: { type: string; url: string }[]) {
  await config.hooks!.listen!(undefined as never, { getURLs: () => urls })
}

describe('development tunnel auth origin', () => {
  it('uses only the active HTTPS tunnel origin for app origin checks', async () => {
    await listen([
      { type: 'local', url: 'http://localhost:3000/' },
      { type: 'tunnel', url: 'https://active.trycloudflare.com/preview/' },
    ])
    expect(process.env.BETTER_AUTH_URL).toBe('https://active.trycloudflare.com')
    expect(appOrigin()).toBe('https://active.trycloudflare.com')
    expect(isSameOrigin('https://active.trycloudflare.com')).toBe(true)
    expect(isSameOrigin('https://other.trycloudflare.com')).toBeFalsy()
    expect(isSameOrigin('https://active.trycloudflare.com.evil.com')).toBeFalsy()
  })

  it('replaces the previous tunnel origin on restart', async () => {
    await listen([{ type: 'tunnel', url: 'https://first.trycloudflare.com' }])
    await listen([{ type: 'tunnel', url: 'https://second.trycloudflare.com' }])
    expect(process.env.BETTER_AUTH_URL).toBe('https://second.trycloudflare.com')
    expect(isSameOrigin('https://first.trycloudflare.com')).toBeFalsy()
  })

  it('allows authentication and session cookies on the tunnel but rejects another origin', async () => {
    await listen([{ type: 'tunnel', url: 'https://active.trycloudflare.com' }])
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret-123')
    const db = createDb(':memory:')
    vi.stubGlobal('useDb', () => db)
    try {
      const { useAuth } = await import('../server/utils/auth')
      const auth = useAuth()
      // Better Auth skips origin checks in test mode; enable them for this regression test.
      ;(await auth.$context).skipOriginCheck = false
      const { token } = createInvite(db, { createdBy: null })
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
      db.$client.close()
    }
  })

  it('preserves the configured URL without a tunnel', async () => {
    await listen([{ type: 'local', url: 'http://localhost:3001' }])
    expect(process.env.BETTER_AUTH_URL).toBe('http://localhost:3000')
  })

  it('preserves the configured URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await listen([{ type: 'tunnel', url: 'https://active.trycloudflare.com' }])
    expect(process.env.BETTER_AUTH_URL).toBe('http://localhost:3000')
  })

  it.each(['not a URL', 'http://active.trycloudflare.com', 'https://user:password@active.trycloudflare.com'])(
    'rejects an invalid tunnel URL: %s',
    async url => {
      await expect(listen([{ type: 'tunnel', url }])).rejects.toThrow('The development tunnel must provide a valid HTTPS URL')
      expect(process.env.BETTER_AUTH_URL).toBe('http://localhost:3000')
    },
  )
})
