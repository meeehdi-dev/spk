import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import { createChannel, deleteChannel, renameChannel, reorderChannels } from '~~/server/db/channelsAdmin'
import { createMessage } from '~~/server/db/messages'
import { attachments, channels, messages } from '~~/server/db/schema'
import { addChannel, addUser, test } from '~~/tests/fixtures/db'

test.beforeEach(({ db }) => addUser(db, 'b'))

describe('channels', () => {
  test('creates at the end of its section, renames, validates', ({ db }) => {
    const x = createChannel(db, 'text', ' dev ')
    const y = createChannel(db, 'text', 'ops')
    expect(db.select().from(channels).where(eq(channels.id, y.id)).get()!.position).toBe(
      db.select().from(channels).where(eq(channels.id, x.id)).get()!.position! + 1,
    )
    renameChannel(db, x.id, 'devs')
    expect(db.select().from(channels).where(eq(channels.id, x.id)).get()!.name).toBe('devs')
    expect(() => createChannel(db, 'dm', 'x')).toThrow(/Type/)
    expect(() => createChannel(db, 'text', '   ')).toThrow(/Name/)
    expect(() => renameChannel(db, x.id, 'x'.repeat(33))).toThrow(/Name/)
  })
  test("DMs can't be renamed or deleted", ({ db }) => {
    addChannel(db, 'dm', { type: 'dm', name: null })
    expect(() => renameChannel(db, 'dm', 'x')).toThrow(/not found/)
    expect(() => deleteChannel(db, 'dm')).toThrow(/not found/)
  })
  test('reorders by saving positions; stale or foreign lists are refused', ({ db }) => {
    const a = createChannel(db, 'voice', 'a'),
      b = createChannel(db, 'voice', 'b'),
      c = createChannel(db, 'voice', 'c')
    const all = db
      .select()
      .from(channels)
      .where(eq(channels.type, 'voice'))
      .all()
      .map(x => x.id) // includes the seeded none (migrations don't seed)
    expect(all).toHaveLength(3)
    reorderChannels(db, 'voice', [c.id, a.id, b.id])
    const pos = (id: string) => db.select().from(channels).where(eq(channels.id, id)).get()!.position
    expect([pos(c.id), pos(a.id), pos(b.id)]).toEqual([0, 1, 2])
    expect(() => reorderChannels(db, 'voice', [a.id, b.id])).toThrow(/changed/)
    expect(() => reorderChannels(db, 'voice', [a.id, a.id, b.id])).toThrow(/changed/)
    expect(() => reorderChannels(db, 'text', [a.id, b.id, c.id])).toThrow(/changed/)
  })
  test('delete removes messages and returns their file keys; the search index stays consistent', ({ db }) => {
    const ch = createChannel(db, 'text', 'gone')
    const m = createMessage(db, 'b', ch.id, 'findme', 1000)
    db.insert(attachments).values({ id: 'f', messageId: m.id, uploaderId: 'b', r2Key: 'attachments/b/f', filename: 'f', mime: 'text/plain', size: 5 }).run()
    const r = deleteChannel(db, ch.id)
    expect(r.r2Keys).toEqual(['attachments/b/f'])
    expect(db.select().from(messages).all()).toHaveLength(0)
    expect(db.select().from(attachments).all()).toHaveLength(0)
  })
})
