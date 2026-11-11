import { beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../server/db/client'
import { accessibleChannel, ChatError, createMessage, listMessages } from '../server/db/messages'
import { channelMembers, channels, messageMentions, user } from '../server/db/schema'
import { createLimiter } from '../server/utils/limiter'
import { extractMentionIds, remarkSpk, safeHref } from '../shared/utils/markdown'

let db: Db
const addUser = (id: string) =>
  db
    .insert(user)
    .values({ id, name: id, email: `${id}@x.dev`, displayName: id })
    .run()

beforeEach(() => {
  db = createDb(':memory:')
  addUser('a')
  addUser('b')
  addUser('c')
  db.insert(channels)
    .values([
      { id: 't', type: 'text', name: 't' },
      { id: 'dm', type: 'dm' },
    ])
    .run()
  db.insert(channelMembers)
    .values([
      { channelId: 'dm', userId: 'a' },
      { channelId: 'dm', userId: 'b' },
    ])
    .run()
})

describe('mention extraction', () => {
  it('finds distinct ids, ignores code', () => {
    expect(extractMentionIds('hi <@a> and <@b> <@a>')).toEqual(['a', 'b'])
    expect(extractMentionIds('`<@a>` ok')).toEqual([])
    expect(extractMentionIds('```\n<@a>\n```\n<@b>')).toEqual(['b'])
  })
  it('server stores only real users', () => {
    const m = createMessage(db, 'a', 't', 'x <@b> <@ghost>')
    expect(
      db
        .select()
        .from(messageMentions)
        .all()
        .map(r => [r.messageId, r.userId]),
    ).toEqual([[m.id, 'b']])
  })
})

describe('createMessage', () => {
  it('rejects empty, oversize, no access', () => {
    expect(() => createMessage(db, 'a', 't', '  ')).toThrow(ChatError)
    expect(() => createMessage(db, 'a', 't', 'x'.repeat(200 * 1024 + 1))).toThrow(/200 KB/)
    expect(() => createMessage(db, 'c', 'dm', 'hi')).toThrow(/No access/)
    expect(accessibleChannel(db, 'b', 'dm')).toBeTruthy()
  })
})

describe('listMessages', () => {
  beforeEach(() => {
    for (let i = 0; i < 30; i++) createMessage(db, 'a', 't', `m${i}`, 1000 + i)
  })
  const bodies = (r: { messages: { body: string }[] }) => r.messages.map(m => m.body)

  it('latest page then older page', () => {
    const p1 = listMessages(db, 't', { limit: 10 })
    expect(bodies(p1)).toEqual(Array.from({ length: 10 }, (_, i) => `m${20 + i}`))
    expect(p1.hasMoreBefore).toBe(true)
    const p2 = listMessages(db, 't', { before: p1.messages[0]!.id, limit: 25 })
    expect(bodies(p2)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`))
    expect(p2.hasMoreBefore).toBe(false)
  })
  it('around includes the anchor and both sides', () => {
    const id = listMessages(db, 't', { limit: 100 }).messages[15]!.id
    const r = listMessages(db, 't', { around: id, limit: 10 })
    expect(bodies(r)).toContain('m15')
    expect(bodies(r)[0]).toBe('m10')
    expect(r.hasMoreBefore && r.hasMoreAfter).toBe(true)
  })
  it('after pages forward', () => {
    const id = listMessages(db, 't', { limit: 100 }).messages[25]!.id
    const r = listMessages(db, 't', { after: id, limit: 10 })
    expect(bodies(r)).toEqual(['m26', 'm27', 'm28', 'm29'])
    expect(r.hasMoreAfter).toBe(false)
  })
})

describe('limiter', () => {
  it('allows max per window', () => {
    const ok = createLimiter(2, 1000)
    expect([ok('k', 0), ok('k', 1), ok('k', 2), ok('k', 1001)]).toEqual([true, true, false, true])
  })
})

describe('markdown helpers', () => {
  it('safeHref allows only http, https, mailto', () => {
    expect(safeHref('https://a.dev')).toBe('https://a.dev')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
  })
  it('remark plugin turns <@id> and ||x|| into nodes, html into text', () => {
    const tree: Parameters<ReturnType<typeof remarkSpk>>[0] = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'a <@u1> ||sec|| ||open' }] },
        { type: 'html', value: '<img src=x onerror=1>' },
      ],
    }
    remarkSpk()(tree, {})
    const kids = tree.children![0]!.children!
    expect(kids.map(k => k.type)).toEqual(['text', 'spkMention', 'text', 'spkSpoiler', 'text', 'text', 'text'])
    expect(kids[1]!.data).toMatchObject({ hProperties: { uid: 'u1' } })
    expect(tree.children![1]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '<img src=x onerror=1>' }] })
  })
})
