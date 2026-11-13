import { describe, expect } from 'vitest'

import { openDm } from '~~/server/db/dms'
import { createMessage, listMessages } from '~~/server/db/messages'
import { allUnread, firstUnreadId, markRead, markUnreadFrom, readState } from '~~/server/db/reads'
import { addChannel, addUser, test } from '~~/tests/fixtures/db'

test.beforeEach(({ db }) => {
  for (const id of ['a', 'b', 'c']) addUser(db, id, { createdAt: new Date(0) })
  addChannel(db, 't')
})

describe('unread and mention counts', () => {
  test("counts others' messages after last read, with mentions apart", ({ db }) => {
    createMessage(db, 'b', 't', 'one', 1000)
    createMessage(db, 'b', 't', 'hey <@a>', 2000)
    createMessage(db, 'a', 't', 'mine', 3000) // own messages never count
    expect(readState(db, 'a', 't')).toEqual({ unread: 2, mentions: 1 })
    expect(readState(db, 'c', 't')).toEqual({ unread: 3, mentions: 0 })
    markRead(db, 'a', 't', 5000)
    expect(readState(db, 'a', 't')).toEqual({ unread: 0, mentions: 0 })
    createMessage(db, 'b', 't', 'new', 6000)
    expect(readState(db, 'a', 't').unread).toBe(1)
  })
  test("does not count other people's DMs; counts your DM", ({ db }) => {
    const dm = openDm(db, 'a', 'b')
    createMessage(db, 'b', dm.id, 'psst <@a>', 1000)
    expect(allUnread(db, 'a')[dm.id]).toEqual({ unread: 1, mentions: 1 })
    expect(allUnread(db, 'c')[dm.id]).toBeUndefined()
  })
  test('mark as unread moves the boundary to that message', ({ db }) => {
    const ids = [1000, 2000, 3000].map(t => createMessage(db, 'b', 't', `m${t}`, t).id)
    markRead(db, 'a', 't', 9000)
    expect(firstUnreadId(db, 'a', 't')).toBeNull()
    expect(markUnreadFrom(db, 'a', 't', ids[1])).toBe(true)
    expect(firstUnreadId(db, 'a', 't')).toBe(ids[1])
    expect(readState(db, 'a', 't').unread).toBe(2)
    expect(markUnreadFrom(db, 'a', 't', 'nope')).toBe(false)
    expect(listMessages(db, 't', {}).messages).toHaveLength(3)
  })
})
