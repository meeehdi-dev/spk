import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, type Db } from '../server/db/client'
import { cancelPending, createPendingAttachment, purgeObjects, sweepOrphans } from '../server/db/attachments'
import { ChatError, createMessage, deleteMessage, editMessage, isEmoji, listMessages, setReaction } from '../server/db/messages'
import { attachments, channelMembers, channels, messageMentions, reactions, user } from '../server/db/schema'
import { cleanMime, formatBytes, MAX_FILE_BYTES } from '../shared/utils/files'
import { setFenceLanguage } from '../shared/utils/markdown'

let db: Db
const addUser = (id: string) => db.insert(user).values({ id, name: id, email: `${id}@x.dev`, displayName: id }).run()
const fts = (q: string) => db.all<{ rowid: number }>(sql`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${q}`).length

beforeEach(() => {
  db = createDb(':memory:')
  addUser('a'); addUser('b'); addUser('c')
  db.insert(channels).values([{ id: 't', type: 'text', name: 't' }, { id: 'dm', type: 'dm' }]).run()
  db.insert(channelMembers).values([{ channelId: 'dm', userId: 'a' }, { channelId: 'dm', userId: 'b' }]).run()
})

describe('edit', () => {
  it('only the author edits, forever, and mentions follow the new text', () => {
    const m = createMessage(db, 'a', 't', 'hi <@b>', 1000)
    expect(() => editMessage(db, 'b', m.id, 'hacked')).toThrow(/own messages/)
    const e = editMessage(db, 'a', m.id, 'hi <@c>', 9_999_999_999)
    expect(e.body).toBe('hi <@c>')
    expect(e.editedAt).toBe(9_999_999_999)
    expect(db.select().from(messageMentions).all().map(r => r.userId)).toEqual(['c'])
    expect(fts('hacked')).toBe(0)
    expect(() => editMessage(db, 'a', m.id, '   ')).toThrow(/empty/)
  })
  it('a third user cannot even see a DM message', () => {
    const m = createMessage(db, 'a', 'dm', 'secret')
    expect(() => editMessage(db, 'c', m.id, 'x')).toThrow(/not found/)
    expect(() => deleteMessage(db, 'c', true, m.id)).toThrow(/not found/)
  })
})

describe('delete', () => {
  it('author or admin only; removes everything attached and returns R2 keys', () => {
    const att = createPendingAttachment(db, 'a', { filename: 'x.png', mime: 'image/png', size: 10 })
    const m = createMessage(db, 'a', 't', 'bye <@b> needle', 1000, { attachments: [{ id: att.id }] })
    setReaction(db, 'b', m.id, '👍', true)
    expect(fts('needle')).toBe(1)
    expect(() => deleteMessage(db, 'b', false, m.id)).toThrow(/own messages/)
    const d = deleteMessage(db, 'b', true, m.id) // admin
    expect(d.r2Keys).toEqual([att.r2Key])
    expect(db.select().from(attachments).all()).toEqual([])
    expect(db.select().from(reactions).all()).toEqual([])
    expect(db.select().from(messageMentions).all()).toEqual([])
    expect(fts('needle')).toBe(0)
    expect(listMessages(db, 't', {}).messages).toEqual([])
    expect(() => deleteMessage(db, 'a', false, m.id)).toThrow(/not found/)
  })
  it('calls R2 delete for each file and keeps going after a failure', async () => {
    const del = vi.fn(async (k: string) => { if (k === 'b') throw new Error('boom') })
    expect(await purgeObjects(['a', 'b', 'c'], del)).toEqual(['b'])
    expect(del).toHaveBeenCalledTimes(3)
  })
})

describe('replies', () => {
  it('previews the original, pings its author, and shows "deleted" afterwards', () => {
    const o = createMessage(db, 'a', 't', '\n first line\nsecond', 1000)
    const r = createMessage(db, 'b', 't', 'yes', 2000, { replyToId: o.id })
    expect(r.replyTo).toMatchObject({ id: o.id, userId: 'a', preview: 'first line', deleted: false })
    expect(db.select().from(messageMentions).all().map(x => [x.messageId, x.userId])).toEqual([[r.id, 'a']])
    expect(() => createMessage(db, 'b', 'dm', 'x', 3000, { replyToId: o.id })).toThrow(/no longer exists/) // other channel / no access
    deleteMessage(db, 'a', false, o.id)
    expect(listMessages(db, 't', {}).messages[0]!.replyTo).toMatchObject({ deleted: true, preview: '' })
  })
})

describe('reactions', () => {
  it('toggle per user, group by emoji, reject non-emoji', () => {
    const m = createMessage(db, 'a', 't', 'x')
    setReaction(db, 'a', m.id, '👍', true)
    setReaction(db, 'a', m.id, '👍', true)
    const r = setReaction(db, 'b', m.id, '👍', true)
    expect(r.reactions).toEqual([{ emoji: '👍', userIds: ['a', 'b'] }])
    expect(setReaction(db, 'a', m.id, '👍', false).reactions).toEqual([{ emoji: '👍', userIds: ['b'] }])
    expect(() => setReaction(db, 'a', m.id, 'abc', true)).toThrow(/emoji/)
    expect(isEmoji('👍🏽') && isEmoji('🇫🇷') && isEmoji('1️⃣') && isEmoji('❤️')).toBe(true)
    expect(isEmoji('a') || isEmoji('👍👍') || isEmoji('')).toBe(false)
    const dm = createMessage(db, 'a', 'dm', 'x')
    expect(() => setReaction(db, 'c', dm.id, '👍', true)).toThrow(/not found/)
  })
})

describe('attachments', () => {
  it('presign rejects bad size and type', () => {
    const ok = { filename: 'a.txt', mime: 'text/plain', size: 5 }
    expect(createPendingAttachment(db, 'a', ok).messageId).toBeNull()
    for (const size of [0, -1, 1.5, MAX_FILE_BYTES + 1, '5', undefined]) expect(() => createPendingAttachment(db, 'a', { ...ok, size })).toThrow(ChatError)
    for (const mime of ['', 'text', 'text/plain; charset=x', '../x/y', undefined, 5]) expect(() => createPendingAttachment(db, 'a', { ...ok, mime })).toThrow(/type/)
    expect(createPendingAttachment(db, 'a', { ...ok, size: MAX_FILE_BYTES }).size).toBe(MAX_FILE_BYTES)
    expect(createPendingAttachment(db, 'a', { ...ok, filename: '../a/b\u0000.txt' }).filename).toBe('..ab.txt')
  })
  it('links in the send transaction, only your own unsent files, max 10', () => {
    const mk = (u: string) => createPendingAttachment(db, u, { filename: 'f', mime: 'a/b', size: 1 })
    const mine = mk('a'), theirs = mk('b')
    expect(() => createMessage(db, 'a', 't', 'x', 1, { attachments: [{ id: theirs.id }] })).toThrow(/attachment/)
    expect(db.select().from(messageMentions).all()).toEqual([])
    expect(listMessages(db, 't', {}).messages).toEqual([]) // rolled back with the message
    const m = createMessage(db, 'a', 't', '', 1, { attachments: [{ id: mine.id, spoiler: true }] })
    expect(m.attachments).toEqual([{ id: mine.id, filename: 'f', mime: 'a/b', size: 1, spoiler: true }])
    expect(() => createMessage(db, 'a', 't', 'again', 2, { attachments: [{ id: mine.id }] })).toThrow(/attachment/)
    const many = Array.from({ length: 11 }, () => ({ id: mk('a').id }))
    expect(() => createMessage(db, 'a', 't', 'x', 3, { attachments: many })).toThrow(/At most 10/)
    expect(() => createMessage(db, 'a', 't', '', 3)).toThrow(/empty/)
  })
  it('cancel only removes your own unsent upload', () => {
    const a = createPendingAttachment(db, 'a', { filename: 'f', mime: 'a/b', size: 1 })
    expect(cancelPending(db, 'b', a.id)).toBeNull()
    expect(cancelPending(db, 'a', a.id)).toBe(a.r2Key)
  })
  it('sweeps unsent uploads older than 24 h, keeps sent and fresh ones, retries failures', async () => {
    const day = 24 * 3600_000
    const old = createPendingAttachment(db, 'a', { filename: 'f', mime: 'a/b', size: 1 }, 1000)
    createPendingAttachment(db, 'a', { filename: 'f', mime: 'a/b', size: 1 }, day) // fresh
    const sent = createPendingAttachment(db, 'a', { filename: 'f', mime: 'a/b', size: 1 }, 1000)
    createMessage(db, 'a', 't', 'x', 1, { attachments: [{ id: sent.id }] })
    const del = vi.fn(async () => { throw new Error('r2 down') })
    expect(await sweepOrphans(db, del, day + 2000)).toBe(0)
    expect(db.select().from(attachments).all()).toHaveLength(3)
    const ok = vi.fn(async () => {})
    expect(await sweepOrphans(db, ok, day + 2000)).toBe(1)
    expect(ok).toHaveBeenCalledWith(old.r2Key)
    expect(db.select().from(attachments).all()).toHaveLength(2)
  })
})

describe('helpers', () => {
  it('mime and bytes', () => {
    expect(cleanMime('Image/PNG')).toBe('image/png')
    expect(cleanMime('x')).toBeNull()
    expect(formatBytes(20 * 1024 * 1024)).toMatch(/20\s?MB/)
    expect(formatBytes(300)).toMatch(/300\s?byte|300\s?B/)
  })
})

describe('setFenceLanguage', () => {
  const body = 'a\n```\none\n```\n\n    indented\n\n```ts\ntwo\n```\n> ```py\n> q\n> ```\n```\none\n```'
  it('rewrites the fenced block with that code (Nth of identical ones)', () => {
    expect(setFenceLanguage(body, 0, 'js', 'one')).toBe(body.replace('```\none', '```js\none'))
    expect(setFenceLanguage(body, 1, 'js', 'one')!.endsWith('```js\none\n```')).toBe(true)
    expect(setFenceLanguage(body, 0, 'js', 'two')).toBe(body.replace('```ts', '```js'))
    expect(setFenceLanguage(body, 0, 'js', 'q')).toContain('> ```js\n> q')
    expect(setFenceLanguage(body, 0, 'js', 'indented')).toBeNull()
    expect(setFenceLanguage(body, 2, 'js', 'one')).toBeNull()
  })
  it('handles longer fences and a fence inside another', () => {
    const b = '````md\n```\nx\n```\n````'
    expect(setFenceLanguage(b, 0, 'text', '```\nx\n```')).toBe('````text\n```\nx\n```\n````')
    expect(setFenceLanguage(b, 0, 'text', 'x')).toBeNull()
  })
})
