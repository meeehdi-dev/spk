import { eq } from 'drizzle-orm'
import { describe, expect, vi } from 'vitest'

import { MAX_FILE_BYTES } from '#shared/utils/files'
import { cancelPending, createPendingAttachment, purgeObjects, sweepOrphans } from '~~/server/db/attachments'
import { ChatError, createMessage, listMessages } from '~~/server/db/messages'
import { attachments, messageMentions } from '~~/server/db/schema'
import { seedChat, test } from '~~/tests/fixtures/db'

const file = { filename: 'f', mime: 'a/b', size: 1 }
const ids = (rows: { id: string }[]) => rows.map(a => a.id)

test.beforeEach(({ db }) => seedChat(db))

describe('createPendingAttachment', () => {
  test('rejects bad size and type', ({ db }) => {
    const ok = { filename: 'a.txt', mime: 'text/plain', size: 5 }
    expect(createPendingAttachment(db, 'a', ok).messageId).toBeNull()
    for (const size of [0, -1, 1.5, MAX_FILE_BYTES + 1, '5', undefined]) expect(() => createPendingAttachment(db, 'a', { ...ok, size })).toThrow(ChatError)
    for (const mime of ['', 'text', 'text/plain; charset=x', '../x/y', undefined, 5])
      expect(() => createPendingAttachment(db, 'a', { ...ok, mime })).toThrow(/type/)
    expect(createPendingAttachment(db, 'a', { ...ok, size: MAX_FILE_BYTES }).size).toBe(MAX_FILE_BYTES)
    expect(createPendingAttachment(db, 'a', { ...ok, filename: '../a/b\u0000.txt' }).filename).toBe('..ab.txt')
  })
  test('links in the send transaction, only your own unsent files, max 10', ({ db }) => {
    const mk = (u: string) => createPendingAttachment(db, u, file)
    const mine = mk('a'),
      theirs = mk('b')
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
})

describe('cancelPending', () => {
  test('only removes your own unsent upload', ({ db }) => {
    const a = createPendingAttachment(db, 'a', file)
    expect(cancelPending(db, 'b', a.id)).toBeNull()
    expect(cancelPending(db, 'a', a.id)).toBe(a.r2Key)
  })
})

describe('purgeObjects', () => {
  test('calls R2 delete for each file and keeps going after a failure', async () => {
    const del = vi.fn(async (k: string) => {
      if (k === 'b') throw new Error('boom')
    })
    expect(await purgeObjects(['a', 'b', 'c'], del)).toEqual(['b'])
    expect(del).toHaveBeenCalledTimes(3)
  })
})

describe('sweepOrphans', () => {
  test('sweeps unsent uploads older than 24 h, keeps sent and fresh ones, retries failures', async ({ db }) => {
    const day = 24 * 3600_000
    const old = createPendingAttachment(db, 'a', file, 1000)
    createPendingAttachment(db, 'a', file, day) // fresh
    const sent = createPendingAttachment(db, 'a', file, 1000)
    createMessage(db, 'a', 't', 'x', 1, { attachments: [{ id: sent.id }] })
    const del = vi.fn(async () => {
      throw new Error('r2 down')
    })
    expect(await sweepOrphans(db, del, day + 2000)).toBe(0)
    expect(db.select().from(attachments).all()).toHaveLength(3)
    const ok = vi.fn(async () => {})
    expect(await sweepOrphans(db, ok, day + 2000)).toBe(1)
    expect(ok).toHaveBeenCalledWith(old.r2Key)
    expect(db.select().from(attachments).all()).toHaveLength(2)
  })
  test('rejects a pending upload older than 23 h, and the sweep never deletes a linked row', async ({ db }) => {
    const h = 3600_000
    const stale = createPendingAttachment(db, 'a', file, 0)
    expect(() => createMessage(db, 'a', 't', 'x', 23.5 * h, { attachments: [{ id: stale.id }] })).toThrow(/attachment/)
    const ok = createPendingAttachment(db, 'a', file, 0)
    createMessage(db, 'a', 't', 'x', 22 * h, { attachments: [{ id: ok.id }] })
    const del = vi.fn(async () => {})
    expect(await sweepOrphans(db, del, 30 * h)).toBe(1)
    expect(del).toHaveBeenCalledWith(stale.r2Key)
    expect(ids(db.select().from(attachments).all())).toEqual([ok.id])
  })
  test('keeps a row that gets linked to a message while R2 is being deleted', async ({ db }) => {
    const raced = createPendingAttachment(db, 'a', file, 0)
    const m = createMessage(db, 'a', 't', 'x', 1)
    const link = vi.fn(async () => {
      db.update(attachments).set({ messageId: m.id }).where(eq(attachments.id, raced.id)).run()
    })
    await sweepOrphans(db, link, 30 * 3600_000)
    expect(link).toHaveBeenCalledWith(raced.r2Key)
    expect(
      db
        .select()
        .from(attachments)
        .all()
        .map(a => [a.id, a.messageId]),
    ).toEqual([[raced.id, m.id]])
  })
})
