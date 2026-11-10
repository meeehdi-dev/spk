import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../server/db/client'
import { listChannelsFor, openDm } from '../server/db/dms'
import { accessibleChannel, createMessage, listMessages } from '../server/db/messages'
import { allUnread, firstUnreadId, markRead, markUnreadFrom, readState } from '../server/db/reads'
import { channels, user } from '../server/db/schema'

let db: Db
const addUser = (id: string, createdAt = new Date(0)) => db.insert(user).values({ id, name: id, email: `${id}@x.dev`, displayName: id, createdAt }).run()

beforeEach(() => {
  db = createDb(':memory:')
  addUser('a'); addUser('b'); addUser('c')
  db.insert(channels).values({ id: 't', type: 'text', name: 't' }).run()
})

describe('DM access', () => {
  it('is 1:1, reused, and closed to a third user', () => {
    const dm = openDm(db, 'a', 'b')
    expect(openDm(db, 'b', 'a').id).toBe(dm.id)
    expect(accessibleChannel(db, 'a', dm.id)).toBeTruthy()
    expect(accessibleChannel(db, 'b', dm.id)).toBeTruthy()
    expect(accessibleChannel(db, 'c', dm.id)).toBeNull()
    expect(() => createMessage(db, 'c', dm.id, 'hi')).toThrow(/No access/)
    expect(() => openDm(db, 'a', 'a')).toThrow()
    expect(() => openDm(db, 'a', 'ghost')).toThrow(/not found/)
  })
  it('lists only your own DMs, newest activity first', () => {
    const ab = openDm(db, 'a', 'b'), ac = openDm(db, 'a', 'c'), bc = openDm(db, 'b', 'c')
    createMessage(db, 'a', ab.id, 'x', 1000); createMessage(db, 'a', ac.id, 'y', 2000); createMessage(db, 'b', bc.id, 'z', 3000)
    const dms = listChannelsFor(db, 'a').filter(c => c.type === 'dm')
    expect(dms.map(d => [d.id, d.otherUserId])).toEqual([[ac.id, 'c'], [ab.id, 'b']])
  })
})

describe('unread and mention counts', () => {
  it('counts others\' messages after last read, with mentions apart', () => {
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
  it('does not count other people\'s DMs; counts your DM', () => {
    const dm = openDm(db, 'a', 'b')
    createMessage(db, 'b', dm.id, 'psst <@a>', 1000)
    expect(allUnread(db, 'a')[dm.id]).toEqual({ unread: 1, mentions: 1 })
    expect(allUnread(db, 'c')[dm.id]).toBeUndefined()
  })
  it('mark as unread moves the boundary to that message', () => {
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
