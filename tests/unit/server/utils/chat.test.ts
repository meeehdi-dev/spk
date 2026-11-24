import { beforeEach, describe, expect, vi } from 'vitest'

import { createMessage } from '~~/server/db/messages'
import { readState } from '~~/server/db/reads'
import { publishMessage } from '~~/server/utils/chat'
import { onlineUserIds, sendToUser } from '~~/server/utils/peers'
import { queuePreviews } from '~~/server/utils/previews'
import { sendPushes } from '~~/server/utils/push'
import { seedChat, test } from '~~/tests/fixtures/db'

vi.mock('~~/server/utils/peers', () => ({ onlineUserIds: vi.fn(), sendToUser: vi.fn(), setManualStatus: vi.fn(), setPeerIdle: vi.fn(), broadcast: vi.fn() }))
vi.mock('~~/server/utils/previews', () => ({ queuePreviews: vi.fn() }))
vi.mock('~~/server/utils/push', () => ({ sendPushes: vi.fn() }))
vi.mock('~~/server/utils/voice', () => ({ handleVoiceFrame: vi.fn() }))
vi.mock('~~/server/utils/connectionDiag', () => ({ logConnectionDiag: vi.fn() }))

let db: ReturnType<typeof useDb>
vi.stubGlobal('useDb', () => db)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(onlineUserIds).mockReturnValue(['a', 'b', 'c'])
})

describe('publishMessage', () => {
  test('with a sender: marks read, fans out to members, sends unread counts', ({ db: d }) => {
    db = d
    seedChat(d)
    const message = createMessage(d, 'a', 'dm', 'hi')
    publishMessage(message, { senderId: 'a', nonce: 'n1' })
    expect(queuePreviews).toHaveBeenCalledWith(message)
    expect(sendPushes).toHaveBeenCalledWith(message)
    expect(sendToUser).toHaveBeenCalledWith('a', { type: 'message:new', message, nonce: 'n1' })
    expect(sendToUser).toHaveBeenCalledWith('b', { type: 'message:new', message, nonce: 'n1' })
    expect(sendToUser).not.toHaveBeenCalledWith('c', expect.anything())
    expect(sendToUser).toHaveBeenCalledWith('a', { type: 'unread:update', channelId: 'dm', ...readState(d, 'a', 'dm') })
    expect(readState(d, 'a', 'dm').unread).toBe(0)
  })

  test('without a sender: reaches all members and skips previews when disabled', ({ db: d }) => {
    db = d
    seedChat(d)
    const message = createMessage(d, 'a', 't', 'hi')
    publishMessage(message, { previews: false })
    expect(queuePreviews).not.toHaveBeenCalled()
    for (const id of ['a', 'b', 'c']) expect(sendToUser).toHaveBeenCalledWith(id, expect.objectContaining({ type: 'message:new' }))
  })
})
