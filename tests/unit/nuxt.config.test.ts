import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { appOrigin } from '../../server/utils/appOrigin'
import { isSameOrigin } from '../../server/utils/sameOrigin'

let config: typeof import('../../nuxt.config').default
beforeAll(async () => {
  vi.stubGlobal('defineNuxtConfig', (value: unknown) => value)
  config = (await import('../../nuxt.config')).default
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

describe('manual chunk error handling', () => {
  it('enables Nuxt manual handling without disabling the manifest', () => {
    expect(config.experimental?.emitRouteChunkError).toBe('manual')
    expect(config.experimental).not.toHaveProperty('appManifest', false)
  })
})

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
