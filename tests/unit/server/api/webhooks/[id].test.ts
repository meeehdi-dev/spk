import { afterEach, describe, expect, vi } from 'vitest'

import { createWebhook, verifyWebhook } from '~~/server/db/webhooks'
import { addUser, test } from '~~/tests/fixtures/db'
import { stubNitro } from '~~/tests/fixtures/nitro'

let me: { id: string; role: string }
let id: string
let body: unknown
const broadcast = vi.fn()
type H = (event: never) => Promise<Record<string, string> & { url: string }>
let patch: H, del: H, secret: H

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  broadcast.mockReset()
  addUser(db, 'a')
  addUser(db, 'b')
  me = { id: 'a', role: 'user' }
  id = createWebhook(db, 'a', { name: 'x', icon: 'bell' }).channel.id
  body = { name: 'Renamed' }
  stubNitro({
    requireUser: async () => me,
    useDb: () => db,
    getRouterParam: () => id,
    readBody: async () => body,
    broadcast,
    webhookUrl: (await import('~~/server/utils/webhookUrl')).webhookUrl,
    asHttp: (await import('~~/server/utils/http')).asHttp,
  })
  patch = (await import('~~/server/api/webhooks/[id].patch')).default as unknown as H
  del = (await import('~~/server/api/webhooks/[id].delete')).default as unknown as H
  secret = (await import('~~/server/api/webhooks/[id]/secret.post')).default as unknown as H
})
afterEach(() => vi.unstubAllGlobals())

describe('/api/webhooks/:id', () => {
  test('PATCH renames and broadcasts', async () => {
    expect(await patch({} as never)).toMatchObject({ id, name: 'Renamed' })
    expect(broadcast).toHaveBeenCalledWith({ type: 'channels:changed' })
  })
  test('POST secret returns a new URL and kills the old secret', async ({ db }) => {
    const old = createWebhook(db, 'a', { name: 'y', icon: 'bell' })
    id = old.channel.id
    const { url } = await secret({} as never)
    expect(url.endsWith(`/api/hooks/${id}/${old.secret}`)).toBe(false)
    expect(verifyWebhook(db, id, old.secret)).toBeNull()
    expect(verifyWebhook(db, id, url.split('/').pop()!)).toBeTruthy()
  })
  test('DELETE removes the webhook', async ({ db }) => {
    await del({} as never)
    expect(verifyWebhook(db, id, 'x')).toBeNull()
    await expect(del({} as never)).rejects.toMatchObject({ statusCode: 404 })
  })
  test('a stranger gets 403, and 404 for a private feed', async ({ db }) => {
    me = { id: 'b', role: 'user' }
    await expect(patch({} as never)).rejects.toMatchObject({ statusCode: 403 })
    id = createWebhook(db, 'a', { name: 'p', icon: 'bell', private: true }).channel.id
    me = { id: 'b', role: 'admin' }
    await expect(del({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(broadcast).not.toHaveBeenCalled()
  })
})
