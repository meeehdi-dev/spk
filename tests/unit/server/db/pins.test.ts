import { describe, expect } from 'vitest'

import { createMessage, deleteMessage, listMessages } from '~~/server/db/messages'
import { listPins, setPin } from '~~/server/db/pins'
import { seedChat, test } from '~~/tests/fixtures/db'

test.beforeEach(({ db }) => seedChat(db))

describe('setPin', () => {
  test('DM members pin; text channels need an admin', ({ db }) => {
    const dm = createMessage(db, 'a', 'dm', 'dm')
    const t = createMessage(db, 'a', 't', 'text')
    expect(setPin(db, 'b', 'user', dm.id, true)).toEqual({ channelId: 'dm', messageId: dm.id, pinned: true })
    expect(() => setPin(db, 'a', 'user', t.id, true)).toThrow(/Only admins/)
    expect(setPin(db, 'c', 'admin', t.id, true).pinned).toBe(true)
  })
  test('hides DMs from outsiders and refuses missing or deleted messages', ({ db }) => {
    const dm = createMessage(db, 'a', 'dm', 'dm')
    expect(() => setPin(db, 'c', 'admin', dm.id, true)).toThrow(/not found/)
    expect(() => setPin(db, 'a', 'admin', 'nope', true)).toThrow(/not found/)
    expect(() => setPin(db, 'a', 'admin', 42, true)).toThrow(/not found/)
    deleteMessage(db, 'a', false, dm.id)
    expect(() => setPin(db, 'a', 'user', dm.id, true)).toThrow(/not found/)
  })
  test('is idempotent and shows on the message', ({ db }) => {
    const m = createMessage(db, 'a', 'dm', 'x')
    setPin(db, 'a', 'user', m.id, true, 1000)
    setPin(db, 'b', 'user', m.id, true, 2000)
    expect(listPins(db, 'a', 'dm')).toMatchObject([{ id: m.id, pinnedAt: 1000, pinnedBy: 'a', pinned: true }])
    expect(listMessages(db, 'dm', {}).messages[0]!.pinned).toBe(true)
    setPin(db, 'a', 'user', m.id, false)
    setPin(db, 'a', 'user', m.id, false)
    expect(listPins(db, 'a', 'dm')).toEqual([])
    expect(listMessages(db, 'dm', {}).messages[0]!.pinned).toBe(false)
  })
})

describe('listPins', () => {
  test('newest pin first, per channel, access checked; deleting a message drops its pin', ({ db }) => {
    const [x, y, z] = ['x', 'y', 'z'].map((b, i) => createMessage(db, 'a', 'dm', b, 1000 + i))
    setPin(db, 'a', 'user', y!.id, true, 1)
    setPin(db, 'a', 'user', x!.id, true, 2)
    setPin(db, 'a', 'user', z!.id, true, 3)
    setPin(db, 'a', 'admin', createMessage(db, 'a', 't', 'other').id, true)
    expect(listPins(db, 'b', 'dm').map(p => p.body)).toEqual(['z', 'x', 'y'])
    expect(() => listPins(db, 'c', 'dm')).toThrow(/No access/)
    deleteMessage(db, 'a', false, x!.id)
    expect(listPins(db, 'a', 'dm').map(p => p.body)).toEqual(['z', 'y'])
  })
})
