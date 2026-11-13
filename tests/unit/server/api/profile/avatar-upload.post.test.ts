import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AVATAR_MAX_UPLOAD, AVATAR_TYPES } from '~~/server/utils/avatar'
import { createLimiter } from '~~/server/utils/limiter'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

let handler: (event: never) => Promise<unknown>
let body: unknown
let userId: string | null

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(0)
  body = { size: 1024, type: 'image/png' }
  userId = 'user'
  stubNitro({
    requireUser: requireUserAs(() => userId),
    createLimiter,
    readBody: async () => body,
    AVATAR_MAX_UPLOAD,
    AVATAR_TYPES,
    useR2: () => ({}),
    presignPut: async (_config: unknown, key: string) => `https://storage.example/${key}`,
  })
  handler = (await import('~~/server/api/profile/avatar-upload.post')).default as typeof handler
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('POST /api/profile/avatar-upload', () => {
  it("requires authentication without consuming another user's allowance", async () => {
    userId = null
    for (let i = 0; i < 11; i++) await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    userId = 'user'
    for (let i = 0; i < 10; i++) await expect(handler({} as never)).resolves.toHaveProperty('url')
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('preserves the raw key and signed URL response', async () => {
    const result = (await handler({} as never)) as { key: string; url: string }
    expect(result.key).toMatch(/^avatars\/raw\/user\/[0-9a-f-]{36}$/)
    expect(result.url).toBe(`https://storage.example/${result.key}`)
  })

  it('limits attempts per user and restores capacity on the rolling window boundary', async () => {
    for (let i = 0; i < 10; i++) await expect(handler({} as never)).resolves.toHaveProperty('url')
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 429, message: 'Slow down' })
    userId = 'other'
    await expect(handler({} as never)).resolves.toMatchObject({ key: expect.stringContaining('avatars/raw/other/') })
    userId = 'user'
    vi.setSystemTime(59_999)
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 429 })
    vi.setSystemTime(60_000)
    await expect(handler({} as never)).resolves.toHaveProperty('url')
  })

  it.each([
    undefined,
    { size: 1024, type: 'text/plain' },
    { size: 0, type: 'image/png' },
    { size: -1, type: 'image/png' },
    { size: 1.5, type: 'image/png' },
    { size: '1024', type: 'image/png' },
    { size: AVATAR_MAX_UPLOAD + 1, type: 'image/png' },
  ])('rejects invalid upload input: %j', async input => {
    body = input
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('counts invalid authenticated attempts and rejects excess attempts before reading the body', async () => {
    body = undefined
    for (let i = 0; i < 10; i++) await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 400 })
    vi.stubGlobal('readBody', async () => {
      throw new Error('Body must not be read after the limit')
    })
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 429 })
  })

  it.each(AVATAR_TYPES)('accepts the maximum upload size for %s', async type => {
    body = { size: AVATAR_MAX_UPLOAD, type }
    await expect(handler({} as never)).resolves.toHaveProperty('url')
  })
})
