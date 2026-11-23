import { afterEach, describe, expect, vi } from 'vitest'

import { createMessage } from '~~/server/db/messages'
import { seedChat, test } from '~~/tests/fixtures/db'
import { stubNitro } from '~~/tests/fixtures/nitro'

let id: string
let body: unknown
const fanOut = vi.fn()
let vote: (event: never) => Promise<{ poll: unknown }>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  fanOut.mockReset()
  seedChat(db)
  stubNitro({
    requireUser: async () => ({ id: 'a', role: 'user' }),
    useDb: () => db,
    getRouterParam: () => id,
    readBody: async () => body,
    createLimiter: () => () => true,
    fanOut,
    asHttp: (await import('~~/server/utils/http')).asHttp,
  })
  vote = (await import('~~/server/api/messages/[id]/vote.post')).default as typeof vote
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/messages/:id/vote', () => {
  test('votes and tells the channel', async ({ db }) => {
    const m = createMessage(db, 'b', 'dm', 'Lunch?', Date.now(), { poll: [{ label: 'Pizza' }, { label: 'Sushi' }] })
    id = m.id
    body = { choiceId: m.poll!.options[0]!.id }
    const r = await vote({} as never)
    expect(fanOut).toHaveBeenCalledWith('dm', 'a', { type: 'poll:update', channelId: 'dm', messageId: id, poll: r.poll }, true)
  })
  test('400 for an unknown choice', async ({ db }) => {
    id = createMessage(db, 'b', 'dm', 'Lunch?', Date.now(), { poll: [{ label: 'Pizza' }, { label: 'Sushi' }] }).id
    body = { choiceId: 'nope' }
    await expect(vote({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(fanOut).not.toHaveBeenCalled()
  })
  test('404 for a missing message', async () => {
    id = 'missing'
    body = { choiceId: null }
    await expect(vote({} as never)).rejects.toMatchObject({ statusCode: 404 })
  })
})
