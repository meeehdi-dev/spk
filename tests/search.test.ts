import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../server/db/client'
import { ChatError, createMessage, deleteMessage } from '../server/db/messages'
import { attachments, channelMembers, channels, user } from '../server/db/schema'
import { searchMessages } from '../server/db/search'
import { activeFilter, parseSearch } from '../shared/utils/searchQuery'

describe('parseSearch', () => {
  it('splits words and filters', () => {
    const p = parseSearch('hello from:Alex mentions:@Bo in:#general has:file has:IMAGE has:link before:2026-11-01 after:2026-10-01 world')
    expect(p.terms).toEqual(['hello', 'world'])
    expect(p.from).toEqual(['Alex'])
    expect(p.mentions).toEqual(['Bo'])
    expect(p.in).toEqual(['general'])
    expect(p.has).toEqual(['file', 'image', 'link'])
    expect(p.before).toBe(Date.parse('2026-11-01T00:00:00Z'))
    expect(p.after).toBe(Date.parse('2026-10-02T00:00:00Z')) // after = from the next day on
  })
  it('quoted values, unfinished and invalid filters', () => {
    expect(parseSearch('from:"Al Ex"').from).toEqual(['Al Ex'])
    expect(parseSearch('from:').from).toEqual([])
    expect(parseSearch('has:cat').terms).toEqual(['has:cat'])
    expect(parseSearch('before:2026-13-45').before).toBeUndefined()
    expect(parseSearch('foo:bar').terms).toEqual(['foo:bar'])
    expect(parseSearch('"two words"').terms).toEqual(['two', 'words'])
    expect(parseSearch('AND OR "').terms).toEqual(['AND', 'OR'])
  })
  it('autocomplete target', () => {
    expect(activeFilter('hi from:Al')).toMatchObject({ key: 'from', value: 'Al' })
    expect(activeFilter('hi from:Al ')).toBeNull()
  })
})

let db: Db
const names = { a: 'Alex', b: 'Bo', c: 'Cy' }
const search = (u: string, q: string, o: Record<string, unknown> = {}) => searchMessages(db, u, { q, ...o }).results.map(r => r.text)

beforeEach(() => {
  db = createDb(':memory:')
  for (const [id, n] of Object.entries(names)) db.insert(user).values({ id, name: id, email: `${id}@x.dev`, displayName: n }).run()
  db.insert(channels).values([{ id: 'g', type: 'text', name: 'general' }, { id: 'r', type: 'text', name: 'random' }, { id: 'dm', type: 'dm' }]).run()
  db.insert(channelMembers).values([{ channelId: 'dm', userId: 'a' }, { channelId: 'dm', userId: 'b' }]).run()
})

describe('searchMessages', () => {
  it('prefix, case, quoting and operators as plain text', () => {
    createMessage(db, 'a', 'g', 'Deploying the server')
    createMessage(db, 'a', 'g', 'cats AND dogs')
    expect(search('b', 'deplo')).toEqual(['Deploying the server'])
    expect(search('b', 'cats AND')).toEqual(['cats AND dogs'])
    expect(search('b', '"*) OR (')).toEqual([]) // no syntax error
    expect(search('b', 'zzz')).toEqual([])
  })
  it('every word must match; filters-only works', () => {
    createMessage(db, 'a', 'g', 'red apple')
    createMessage(db, 'a', 'g', 'red car')
    expect(search('b', 'red app')).toEqual(['red apple'])
    expect(search('b', 'from:alex').sort()).toEqual(['red apple', 'red car'])
    expect(search('b', 'from:Cy')).toEqual([])
  })
  it('from / in / mentions / has / dates, alone and combined', () => {
    const t = Date.parse('2026-10-15T12:00:00Z')
    createMessage(db, 'a', 'g', 'one <@b>', t)
    createMessage(db, 'b', 'r', 'two https://example.org', t + 86_400_000 * 20)
    const m3 = createMessage(db, 'b', 'g', 'three', t + 86_400_000 * 40)
    db.insert(attachments).values({ id: 'f1', messageId: m3.id, uploaderId: 'b', r2Key: 'k', filename: 'x.png', mime: 'image/png', size: 1 }).run()
    createMessage(db, 'b', 'g', 'four', t + 86_400_000 * 60)
    expect(search('c', 'from:bo').sort()).toEqual(['four', 'three', 'two https://example.org'])
    expect(search('c', 'in:random')).toEqual(['two https://example.org'])
    expect(search('c', 'in:#GENERAL from:Alex')).toEqual(['one <@b>'])
    expect(search('c', 'mentions:bo')).toEqual(['one <@b>'])
    expect(search('c', 'has:link')).toEqual(['two https://example.org'])
    expect(search('c', 'has:file')).toEqual(['three'])
    expect(search('c', 'has:image from:bo in:general')).toEqual(['three'])
    expect(search('c', 'has:file has:link')).toEqual([])
    expect(search('c', 'before:2026-10-16')).toEqual(['one <@b>'])
    expect(search('c', 'after:2026-10-15 before:2026-11-10')).toEqual(['two https://example.org']) // after = a later day
    expect(search('c', 'after:2026-10-15 before:2026-11-10 from:bo')).toEqual(['two https://example.org'])
  })
  it('renames: from/mentions use current nicknames, a plain nickname finds mentions', () => {
    createMessage(db, 'a', 'g', 'hey <@b> look')
    db.update(user).set({ displayName: 'Robert' }).where(eq(user.id, 'b')).run()
    expect(search('c', 'mentions:Robert')).toEqual(['hey <@b> look'])
    expect(search('c', 'mentions:Bo')).toEqual([])
    expect(search('c', 'robert')).toEqual(['hey <@b> look'])
    db.update(user).set({ displayName: 'Alexa' }).where(eq(user.id, 'a')).run()
    expect(search('c', 'from:alexa')).toEqual(['hey <@b> look'])
  })
  it('no DM leaks, scopes, deleted and edited messages', () => {
    createMessage(db, 'a', 'dm', 'secret plan')
    createMessage(db, 'a', 'g', 'public plan')
    expect(search('c', 'plan')).toEqual(['public plan'])
    expect(search('c', 'from:alex')).toEqual(['public plan'])
    expect(() => search('c', 'plan', { scope: 'channel', channelId: 'dm' })).toThrow(ChatError)
    expect(search('b', 'plan', { scope: 'dms' })).toEqual(['secret plan'])
    expect(search('b', 'plan', { scope: 'channels' })).toEqual(['public plan'])
    expect(search('b', 'plan', { scope: 'channel', channelId: 'g' })).toEqual(['public plan'])
    expect(search('b', 'plan').sort()).toEqual(['public plan', 'secret plan'])
    const m = createMessage(db, 'a', 'g', 'gone soon')
    deleteMessage(db, 'a', false, m.id)
    expect(search('b', 'gone')).toEqual([])
  })
  it('snippet marks, paging with cursor, empty query', () => {
    for (let i = 0; i < 25; i++) createMessage(db, 'a', 'g', `match ${i}`, 1000 + i)
    const p1 = searchMessages(db, 'b', { q: 'match' })
    expect(p1.results).toHaveLength(20)
    expect(p1.results[0]!.snippet).toContain('\u0001match\u0002')
    const p2 = searchMessages(db, 'b', { q: 'match', cursor: p1.nextCursor })
    expect(p2.results).toHaveLength(5)
    expect(p2.nextCursor).toBeNull()
    expect(new Set([...p1.results, ...p2.results].map(r => r.messageId)).size).toBe(25)
    expect(searchMessages(db, 'b', { q: '  ' }).results).toEqual([])
  })
})
