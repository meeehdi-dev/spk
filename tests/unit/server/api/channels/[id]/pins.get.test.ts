import { afterEach, describe, expect, vi } from 'vitest'

import { createMessage } from '~~/server/db/messages'
import { setPin } from '~~/server/db/pins'
import { seedChat, test } from '~~/tests/fixtures/db'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

let userId: string | null
let list: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  seedChat(db)
  userId = 'a'
  stubNitro({ requireUser: requireUserAs(() => userId), useDb: () => db, getRouterParam: () => 'dm', asHttp: (await import('~~/server/utils/http')).asHttp })
  list = (await import('~~/server/api/channels/[id]/pins.get')).default as typeof list
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/channels/:id/pins', () => {
  test('lists pins for members only', async ({ db }) => {
    const m = createMessage(db, 'a', 'dm', 'hi')
    setPin(db, 'a', 'user', m.id, true)
    expect(await list({} as never)).toMatchObject([{ id: m.id, body: 'hi' }])
    userId = 'c'
    await expect(list({} as never)).rejects.toMatchObject({ statusCode: 403 })
    userId = null
    await expect(list({} as never)).rejects.toMatchObject({ statusCode: 401 })
  })
})
