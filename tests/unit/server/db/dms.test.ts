import { describe, expect } from 'vitest'

import { listChannelsFor, openDm } from '~~/server/db/dms'
import { accessibleChannel, createMessage } from '~~/server/db/messages'
import { addUser, test } from '~~/tests/fixtures/db'

test.beforeEach(({ db }) => {
  for (const id of ['a', 'b', 'c']) addUser(db, id, { createdAt: new Date(0) })
})

describe('openDm', () => {
  test('is 1:1, reused, and closed to a third user', ({ db }) => {
    const dm = openDm(db, 'a', 'b')
    expect(openDm(db, 'b', 'a').id).toBe(dm.id)
    expect(accessibleChannel(db, 'a', dm.id)).toBeTruthy()
    expect(accessibleChannel(db, 'b', dm.id)).toBeTruthy()
    expect(accessibleChannel(db, 'c', dm.id)).toBeNull()
    expect(() => createMessage(db, 'c', dm.id, 'hi')).toThrow(/No access/)
    expect(() => openDm(db, 'a', 'a')).toThrow()
    expect(() => openDm(db, 'a', 'ghost')).toThrow(/not found/)
  })
})

describe('listChannelsFor', () => {
  test('lists only your own DMs, newest activity first', ({ db }) => {
    const ab = openDm(db, 'a', 'b'),
      ac = openDm(db, 'a', 'c'),
      bc = openDm(db, 'b', 'c')
    createMessage(db, 'a', ab.id, 'x', 1000)
    createMessage(db, 'a', ac.id, 'y', 2000)
    createMessage(db, 'b', bc.id, 'z', 3000)
    const dms = listChannelsFor(db, 'a').filter(c => c.type === 'dm')
    expect(dms.map(d => [d.id, d.otherUserId])).toEqual([
      [ac.id, 'c'],
      [ab.id, 'b'],
    ])
  })
})
