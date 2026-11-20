import { afterEach, describe, expect, vi } from 'vitest'

import { createMessage } from '~~/server/db/messages'
import { listPins } from '~~/server/db/pins'
import { seedChat, test } from '~~/tests/fixtures/db'
import { stubNitro } from '~~/tests/fixtures/nitro'

let me: { id: string; role: string }
let id: string
let body: unknown
const fanOut = vi.fn()
let pin: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  fanOut.mockReset()
  seedChat(db)
  me = { id: 'a', role: 'user' }
  body = { on: true }
  stubNitro({
    requireUser: async () => me,
    useDb: () => db,
    getRouterParam: () => id,
    readBody: async () => body,
    createLimiter: () => () => true,
    fanOut,
    asHttp: (await import('~~/server/utils/http')).asHttp,
  })
  pin = (await import('~~/server/api/messages/[id]/pin.post')).default as typeof pin
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/messages/:id/pin', () => {
  test('pins and tells the channel', async ({ db }) => {
    id = createMessage(db, 'b', 'dm', 'hi').id
    expect(await pin({} as never)).toEqual({ channelId: 'dm', messageId: id, pinned: true })
    expect(fanOut).toHaveBeenCalledWith('dm', 'a', { type: 'pin:update', channelId: 'dm', messageId: id, pinned: true }, true)
    body = { on: false }
    await pin({} as never)
    expect(listPins(db, 'a', 'dm')).toEqual([])
  })
  test('403 for a non-admin in a text channel, without a live update', async ({ db }) => {
    id = createMessage(db, 'b', 't', 'hi').id
    await expect(pin({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(fanOut).not.toHaveBeenCalled()
    me = { id: 'a', role: 'admin' }
    await pin({} as never)
    expect(listPins(db, 'a', 't')).toHaveLength(1)
  })
})
