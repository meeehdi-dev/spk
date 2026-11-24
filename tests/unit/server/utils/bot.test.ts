import { beforeEach, describe, expect, vi } from 'vitest'

import { createMessage, listMessages } from '~~/server/db/messages'
import { maybeReply } from '~~/server/utils/bot'
import { onlineUserIds, sendToUser } from '~~/server/utils/peers'
import { BOT_ID } from '~~/shared/utils/bot'
import { addChannel, addUser, seedChat, test } from '~~/tests/fixtures/db'

vi.mock('~~/server/utils/peers', () => ({ onlineUserIds: vi.fn(), sendToUser: vi.fn(), setManualStatus: vi.fn(), setPeerIdle: vi.fn(), broadcast: vi.fn() }))
vi.mock('~~/server/utils/previews', () => ({ queuePreviews: vi.fn() }))
vi.mock('~~/server/utils/push', () => ({ sendPushes: vi.fn() }))
vi.mock('~~/server/utils/voice', () => ({ handleVoiceFrame: vi.fn() }))
vi.mock('~~/server/utils/connectionDiag', () => ({ logConnectionDiag: vi.fn() }))

let db: ReturnType<typeof useDb>
let key = 'k'
const fetchMock = vi.fn()
vi.stubGlobal('useDb', () => db)
vi.stubGlobal('useRuntimeConfig', () => ({ anthropicApiKey: key }))
vi.stubGlobal('fetch', fetchMock)

const answer = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }] }))
const botMessages = (channelId: string) => listMessages(db, channelId, {}).messages.filter(m => m.userId === BOT_ID)

function setup(d: typeof db) {
  db = d
  seedChat(d)
  addUser(d, BOT_ID, { displayName: 'spk' })
  vi.mocked(onlineUserIds).mockReturnValue(['a', 'b', 'c'])
}

beforeEach(() => {
  vi.clearAllMocks()
  key = 'k'
  fetchMock.mockImplementation(() => Promise.resolve(answer('hello <@a> there')))
})

describe('maybeReply', () => {
  test('replies to a mention with context and a reply link', async ({ db: d }) => {
    setup(d)
    createMessage(d, 'b', 't', 'earlier')
    const m = createMessage(d, 'a', 't', 'hey <@spk-bot> meet <@b>')
    await maybeReply(m)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('k')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.messages).toEqual([{ role: 'user', content: 'b: earlier\na: hey @spk meet @b' }])
    const [reply] = botMessages('t')
    expect(reply).toMatchObject({ body: 'hello  there', replyTo: { id: m.id } })
    expect(sendToUser).toHaveBeenCalledWith('a', { type: 'typing', channelId: 't', userId: BOT_ID })
  })

  test('replying to a bot message triggers without a mention', async ({ db: d }) => {
    setup(d)
    const botMsg = createMessage(d, BOT_ID, 't', 'hi')
    await maybeReply(createMessage(d, 'a', 't', 'and?', Date.now(), { replyToId: botMsg.id }))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  test('stays silent in dms, on its own messages, without a key, or with no trigger', async ({ db: d }) => {
    setup(d)
    await maybeReply(createMessage(d, 'a', 'dm', '<@spk-bot> hi'))
    await maybeReply(createMessage(d, BOT_ID, 't', '<@spk-bot> hi'))
    await maybeReply(createMessage(d, 'a', 't', 'plain'))
    key = ''
    await maybeReply(createMessage(d, 'a', 't', '<@spk-bot> hi'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('skips the 4th request from one author in a minute', async ({ db: d }) => {
    setup(d)
    addChannel(d, 't2')
    for (let i = 0; i < 4; i++) await maybeReply(createMessage(d, 'c', 't2', '<@spk-bot> hi'))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('posts a fallback when the API fails', async ({ db: d }) => {
    setup(d)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response('no', { status: 500 }))
    await maybeReply(createMessage(d, 'b', 't', '<@spk-bot> hi'))
    expect(botMessages('t')[0]!.body).toBe("Sorry, I couldn't answer that right now.")
  })
})
