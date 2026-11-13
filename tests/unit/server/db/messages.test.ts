import type { Db } from '~~/server/db/client'

import { sql } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import { createPendingAttachment } from '~~/server/db/attachments'
import { accessibleChannel, ChatError, createMessage, deleteMessage, editMessage, isEmoji, listMessages, setReaction } from '~~/server/db/messages'
import { attachments, messageMentions, reactions } from '~~/server/db/schema'
import { seedChat, test } from '~~/tests/fixtures/db'

const fts = (db: Db, q: string) => db.all<{ rowid: number }>(sql`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${q}`).length
const mentions = (db: Db) =>
  db
    .select()
    .from(messageMentions)
    .all()
    .map(r => [r.messageId, r.userId])

test.beforeEach(({ db }) => seedChat(db))

describe('createMessage', () => {
  test('rejects empty, oversize, no access', ({ db }) => {
    expect(() => createMessage(db, 'a', 't', '  ')).toThrow(ChatError)
    expect(() => createMessage(db, 'a', 't', 'x'.repeat(200 * 1024 + 1))).toThrow(/200 KB/)
    expect(() => createMessage(db, 'c', 'dm', 'hi')).toThrow(/No access/)
    expect(accessibleChannel(db, 'b', 'dm')).toBeTruthy()
  })
  test('stores mentions of real users only', ({ db }) => {
    const m = createMessage(db, 'a', 't', 'x <@b> <@ghost>')
    expect(mentions(db)).toEqual([[m.id, 'b']])
  })
})

describe('listMessages', () => {
  test.beforeEach(({ db }) => {
    for (let i = 0; i < 30; i++) createMessage(db, 'a', 't', `m${i}`, 1000 + i)
  })
  const bodies = (r: { messages: { body: string }[] }) => r.messages.map(m => m.body)

  test('latest page then older page', ({ db }) => {
    const p1 = listMessages(db, 't', { limit: 10 })
    expect(bodies(p1)).toEqual(Array.from({ length: 10 }, (_, i) => `m${20 + i}`))
    expect(p1.hasMoreBefore).toBe(true)
    const p2 = listMessages(db, 't', { before: p1.messages[0]!.id, limit: 25 })
    expect(bodies(p2)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`))
    expect(p2.hasMoreBefore).toBe(false)
  })
  test('around includes the anchor and both sides', ({ db }) => {
    const id = listMessages(db, 't', { limit: 100 }).messages[15]!.id
    const r = listMessages(db, 't', { around: id, limit: 10 })
    expect(bodies(r)).toContain('m15')
    expect(bodies(r)[0]).toBe('m10')
    expect(r.hasMoreBefore && r.hasMoreAfter).toBe(true)
  })
  test('after pages forward', ({ db }) => {
    const id = listMessages(db, 't', { limit: 100 }).messages[25]!.id
    const r = listMessages(db, 't', { after: id, limit: 10 })
    expect(bodies(r)).toEqual(['m26', 'm27', 'm28', 'm29'])
    expect(r.hasMoreAfter).toBe(false)
  })
})

describe('editMessage', () => {
  test('only the author edits, forever, and mentions follow the new text', ({ db }) => {
    const m = createMessage(db, 'a', 't', 'hi <@b>', 1000)
    expect(() => editMessage(db, 'b', m.id, 'hacked')).toThrow(/own messages/)
    const e = editMessage(db, 'a', m.id, 'hi <@c>', 9_999_999_999)
    expect(e.body).toBe('hi <@c>')
    expect(e.editedAt).toBe(9_999_999_999)
    expect(mentions(db).map(([, userId]) => userId)).toEqual(['c'])
    expect(fts(db, 'hacked')).toBe(0)
    expect(() => editMessage(db, 'a', m.id, '   ')).toThrow(/empty/)
  })
  test('a third user cannot even see a DM message', ({ db }) => {
    const m = createMessage(db, 'a', 'dm', 'secret')
    expect(() => editMessage(db, 'c', m.id, 'x')).toThrow(/not found/)
    expect(() => deleteMessage(db, 'c', true, m.id)).toThrow(/not found/)
  })
})

describe('deleteMessage', () => {
  test('author or admin only; removes everything attached and returns R2 keys', ({ db }) => {
    const att = createPendingAttachment(db, 'a', { filename: 'x.png', mime: 'image/png', size: 10 })
    const m = createMessage(db, 'a', 't', 'bye <@b> needle', 1000, { attachments: [{ id: att.id }] })
    setReaction(db, 'b', m.id, '👍', true)
    expect(fts(db, 'needle')).toBe(1)
    expect(() => deleteMessage(db, 'b', false, m.id)).toThrow(/own messages/)
    const d = deleteMessage(db, 'b', true, m.id) // admin
    expect(d.r2Keys).toEqual([att.r2Key])
    expect(db.select().from(attachments).all()).toEqual([])
    expect(db.select().from(reactions).all()).toEqual([])
    expect(db.select().from(messageMentions).all()).toEqual([])
    expect(fts(db, 'needle')).toBe(0)
    expect(listMessages(db, 't', {}).messages).toEqual([])
    expect(() => deleteMessage(db, 'a', false, m.id)).toThrow(/not found/)
  })
})

describe('replies', () => {
  test('previews the original, pings its author, and shows "deleted" afterwards', ({ db }) => {
    const o = createMessage(db, 'a', 't', '\n first line\nsecond', 1000)
    const r = createMessage(db, 'b', 't', 'yes', 2000, { replyToId: o.id })
    expect(r.replyTo).toMatchObject({ id: o.id, userId: 'a', preview: 'first line', deleted: false })
    expect(mentions(db)).toEqual([[r.id, 'a']])
    expect(() => createMessage(db, 'b', 'dm', 'x', 3000, { replyToId: o.id })).toThrow(/no longer exists/) // other channel / no access
    deleteMessage(db, 'a', false, o.id)
    expect(listMessages(db, 't', {}).messages[0]!.replyTo).toMatchObject({ deleted: true, preview: '' })
  })
})

describe('setReaction', () => {
  describe('at the type limit', () => {
    const emoji = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚']
    const atLimit = (db: Db) => {
      const messageId = createMessage(db, 'a', 't', 'x').id
      for (const e of emoji) setReaction(db, 'a', messageId, e, true)
      return messageId
    }

    test('allows another user to join an existing type and keeps additions idempotent', ({ db }) => {
      const messageId = atLimit(db)
      const r = setReaction(db, 'b', messageId, '😀', true)
      expect(r.reactions).toHaveLength(20)
      expect(r.reactions.find(r => r.emoji === '😀')?.userIds).toEqual(['a', 'b'])
      expect(setReaction(db, 'b', messageId, '😀', true)).toEqual(r)
      expect(setReaction(db, 'a', messageId, '😀', true)).toEqual(r)
      expect(db.select().from(reactions).all()).toHaveLength(21)

      const removed = setReaction(db, 'b', messageId, '😀', false)
      expect(removed.reactions).toHaveLength(20)
      expect(removed.reactions.find(r => r.emoji === '😀')?.userIds).toEqual(['a'])
      expect(setReaction(db, 'b', messageId, '😀', false)).toEqual(removed)
    })

    test('rejects a new type even if it exists on another message, then frees a slot on removal', ({ db }) => {
      const messageId = atLimit(db)
      const other = createMessage(db, 'a', 't', 'other')
      const before = setReaction(db, 'a', messageId, '😀', true)
      setReaction(db, 'a', other.id, '👍', true)
      for (const userId of ['a', 'b'])
        expect(() => setReaction(db, userId, messageId, '👍', true)).toThrow(
          expect.objectContaining({ statusCode: 400, message: 'Too many different reactions on this message' }),
        )
      expect(setReaction(db, 'a', messageId, '😀', true)).toEqual(before)
      expect(db.select().from(reactions).all()).toHaveLength(21)
      expect(setReaction(db, 'a', messageId, '😀', false).reactions).toHaveLength(19)
      const added = setReaction(db, 'b', messageId, '👍', true)
      expect(added.reactions).toHaveLength(20)
      expect(added.reactions.find(r => r.emoji === '👍')?.userIds).toEqual(['b'])
    })
  })

  test('toggle per user, group by emoji, reject non-emoji', ({ db }) => {
    const m = createMessage(db, 'a', 't', 'x')
    setReaction(db, 'a', m.id, '👍', true)
    setReaction(db, 'a', m.id, '👍', true)
    const r = setReaction(db, 'b', m.id, '👍', true)
    expect(r.reactions).toEqual([{ emoji: '👍', userIds: ['a', 'b'] }])
    expect(setReaction(db, 'a', m.id, '👍', false).reactions).toEqual([{ emoji: '👍', userIds: ['b'] }])
    expect(() => setReaction(db, 'a', m.id, 'abc', true)).toThrow(/emoji/)
    const dm = createMessage(db, 'a', 'dm', 'x')
    expect(() => setReaction(db, 'c', dm.id, '👍', true)).toThrow(/not found/)
  })
})

describe('isEmoji', () => {
  test('accepts a single emoji, including modifiers, flags and keycaps', () => {
    expect(isEmoji('👍🏽') && isEmoji('🇫🇷') && isEmoji('1️⃣') && isEmoji('❤️')).toBe(true)
    expect(isEmoji('a') || isEmoji('👍👍') || isEmoji('')).toBe(false)
  })
})
