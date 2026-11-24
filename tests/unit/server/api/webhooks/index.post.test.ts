import { afterEach, describe, expect, vi } from 'vitest'

import { verifyWebhook } from '~~/server/db/webhooks'
import { addUser, test } from '~~/tests/fixtures/db'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

let current: string | null
let body: unknown
const broadcast = vi.fn()
let create: (event: never) => Promise<{ channel: { id: string; private: boolean }; url: string }>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  broadcast.mockReset()
  addUser(db, 'a')
  current = 'a'
  body = { name: 'Deploys', icon: 'bell', private: true }
  stubNitro({
    requireUser: requireUserAs(() => current),
    useDb: () => db,
    readBody: async () => body,
    broadcast,
    appOrigin: () => 'https://spk.test',
    webhookUrl: (await import('~~/server/utils/webhookUrl')).webhookUrl,
    asHttp: (await import('~~/server/utils/http')).asHttp,
  })
  create = (await import('~~/server/api/webhooks/index.post')).default as typeof create
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/webhooks', () => {
  test('creates a webhook and returns a working URL once', async ({ db }) => {
    const { channel, url } = await create({} as never)
    expect(channel.private).toBe(true)
    const [, id, secret] = url.match(/^https?:\/\/[^/]+\/api\/hooks\/([^/]+)\/(.+)$/) ?? []
    expect(id).toBe(channel.id)
    expect(verifyWebhook(db, id!, secret!)).toBeTruthy()
    expect(broadcast).toHaveBeenCalledWith({ type: 'channels:changed' })
  })
  test('400 for bad input and 401 when signed out, without a broadcast', async () => {
    body = { name: '', icon: 'bell' }
    await expect(create({} as never)).rejects.toMatchObject({ statusCode: 400 })
    current = null
    await expect(create({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(broadcast).not.toHaveBeenCalled()
  })
})
