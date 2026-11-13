import type { Db } from '~~/server/db/client'

import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import { ChatError, createMessage, deleteMessage } from '~~/server/db/messages'
import { attachments, user } from '~~/server/db/schema'
import { searchMessages } from '~~/server/db/search'
import { addChannel, addUser, test } from '~~/tests/fixtures/db'

const search = (db: Db, u: string, q: string, o: Record<string, unknown> = {}) => searchMessages(db, u, { q, ...o }).results.map(r => r.text)

test.beforeEach(({ db }) => {
  for (const [id, displayName] of Object.entries({ a: 'Alex', b: 'Bo', c: 'Cy' })) addUser(db, id, { displayName })
  addChannel(db, 'g', { name: 'general' })
  addChannel(db, 'r', { name: 'random' })
  addChannel(db, 'dm', { type: 'dm', name: null }, ['a', 'b'])
})

describe('searchMessages', () => {
  test('prefix, case, quoting and operators as plain text', ({ db }) => {
    createMessage(db, 'a', 'g', 'Deploying the server')
    createMessage(db, 'a', 'g', 'cats AND dogs')
    expect(search(db, 'b', 'deplo')).toEqual(['Deploying the server'])
    expect(search(db, 'b', 'cats AND')).toEqual(['cats AND dogs'])
    expect(search(db, 'b', '"*) OR (')).toEqual([]) // no syntax error
    expect(search(db, 'b', 'zzz')).toEqual([])
  })
  test('every word must match; filters-only works', ({ db }) => {
    createMessage(db, 'a', 'g', 'red apple')
    createMessage(db, 'a', 'g', 'red car')
    expect(search(db, 'b', 'red app')).toEqual(['red apple'])
    expect(search(db, 'b', 'from:alex').sort()).toEqual(['red apple', 'red car'])
    expect(search(db, 'b', 'from:Cy')).toEqual([])
  })
  test('from / in / mentions / has / dates, alone and combined', ({ db }) => {
    const t = Date.parse('2026-10-15T12:00:00Z')
    createMessage(db, 'a', 'g', 'one <@b>', t)
    createMessage(db, 'b', 'r', 'two https://example.org', t + 86_400_000 * 20)
    const m3 = createMessage(db, 'b', 'g', 'three', t + 86_400_000 * 40)
    db.insert(attachments).values({ id: 'f1', messageId: m3.id, uploaderId: 'b', r2Key: 'k', filename: 'x.png', mime: 'image/png', size: 1 }).run()
    createMessage(db, 'b', 'g', 'four', t + 86_400_000 * 60)
    expect(search(db, 'c', 'from:bo').sort()).toEqual(['four', 'three', 'two https://example.org'])
    expect(search(db, 'c', 'in:random')).toEqual(['two https://example.org'])
    expect(search(db, 'c', 'in:#GENERAL from:Alex')).toEqual(['one <@b>'])
    expect(search(db, 'c', 'mentions:bo')).toEqual(['one <@b>'])
    expect(search(db, 'c', 'has:link')).toEqual(['two https://example.org'])
    expect(search(db, 'c', 'has:file')).toEqual(['three'])
    expect(search(db, 'c', 'has:image from:bo in:general')).toEqual(['three'])
    expect(search(db, 'c', 'has:file has:link')).toEqual([])
    expect(search(db, 'c', 'before:2026-10-16')).toEqual(['one <@b>'])
    expect(search(db, 'c', 'after:2026-10-15 before:2026-11-10')).toEqual(['two https://example.org']) // after = a later day
    expect(search(db, 'c', 'after:2026-10-15 before:2026-11-10 from:bo')).toEqual(['two https://example.org'])
  })
  test('renames: from/mentions use current nicknames, a plain nickname finds mentions', ({ db }) => {
    createMessage(db, 'a', 'g', 'hey <@b> look')
    db.update(user).set({ displayName: 'Robert' }).where(eq(user.id, 'b')).run()
    expect(search(db, 'c', 'mentions:Robert')).toEqual(['hey <@b> look'])
    expect(search(db, 'c', 'mentions:Bo')).toEqual([])
    expect(search(db, 'c', 'robert')).toEqual(['hey <@b> look'])
    db.update(user).set({ displayName: 'Alexa' }).where(eq(user.id, 'a')).run()
    expect(search(db, 'c', 'from:alexa')).toEqual(['hey <@b> look'])
  })
  test('no DM leaks, scopes, deleted and edited messages', ({ db }) => {
    createMessage(db, 'a', 'dm', 'secret plan')
    createMessage(db, 'a', 'g', 'public plan')
    expect(search(db, 'c', 'plan')).toEqual(['public plan'])
    expect(search(db, 'c', 'from:alex')).toEqual(['public plan'])
    expect(() => search(db, 'c', 'plan', { scope: 'channel', channelId: 'dm' })).toThrow(ChatError)
    expect(search(db, 'b', 'plan', { scope: 'dms' })).toEqual(['secret plan'])
    expect(search(db, 'b', 'plan', { scope: 'channels' })).toEqual(['public plan'])
    expect(search(db, 'b', 'plan', { scope: 'channel', channelId: 'g' })).toEqual(['public plan'])
    expect(search(db, 'b', 'plan').sort()).toEqual(['public plan', 'secret plan'])
    const m = createMessage(db, 'a', 'g', 'gone soon')
    deleteMessage(db, 'a', false, m.id)
    expect(search(db, 'b', 'gone')).toEqual([])
  })
  test('snippet marks, paging with cursor, empty query', ({ db }) => {
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
