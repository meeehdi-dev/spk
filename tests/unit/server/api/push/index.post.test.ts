import { afterEach, describe, expect, vi } from 'vitest'

import { pushSubscriptions } from '~~/server/db/schema'
import { addUser, test } from '~~/tests/fixtures/db'
import { stubNitro } from '~~/tests/fixtures/nitro'
import { invalidEndpoints, validEndpoints } from '~~/tests/fixtures/push'

const keys = { p256dh: 'key', auth: 'auth' }

let register: (endpoint: unknown, subscriptionKeys?: unknown) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  addUser(db, 'b', { displayName: null })
  stubNitro({ useDb: () => db, requireUser: async () => ({ id: 'b' }) })
  const { default: handler } = await import('~~/server/api/push/index.post')
  register = (endpoint, subscriptionKeys = keys) => {
    vi.stubGlobal('readBody', async () => ({ subscription: { endpoint, keys: subscriptionKeys } }))
    return handler({} as never)
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/push', () => {
  test.for(invalidEndpoints)('rejects registration without saving: %s', async (value, { db }) => {
    await expect(register(value)).rejects.toMatchObject({ statusCode: 400, message: 'Invalid subscription' })
    expect(db.select().from(pushSubscriptions).all()).toEqual([])
  })

  test.for(validEndpoints)('registers supported subscriptions: %s', async (value, { db }) => {
    await expect(register(value)).resolves.toEqual({ ok: true })
    expect(db.select().from(pushSubscriptions).get()).toMatchObject({ endpoint: value, userId: 'b' })
  })

  test.for([null, {}, { p256dh: 123, auth: 'a' }, { p256dh: 'k', auth: 123 }])('keeps key validation: %s', async (value, { db }) => {
    await expect(register(validEndpoints[0], value)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.select().from(pushSubscriptions).all()).toEqual([])
  })
})
