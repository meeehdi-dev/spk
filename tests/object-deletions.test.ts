import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cancelPending, createPendingAttachment } from '../server/db/attachments'
import { deleteChannel } from '../server/db/channelsAdmin'
import { createDb, type Db } from '../server/db/client'
import { createMessage, deleteMessage } from '../server/db/messages'
import { enqueueObjectDeletion, replaceAvatar, retryObjectDeletions, UPLOAD_DELETE_GRACE_MS } from '../server/db/objectDeletions'
import { attachments, channels, objectDeletions, sounds, user } from '../server/db/schema'
import { deleteSound } from '../server/db/sounds'
import { r2Delete } from '../server/utils/r2sign'

let db: Db
const now = 1000
const due = now + UPLOAD_DELETE_GRACE_MS
const pending = () => createPendingAttachment(db, 'a', { filename: 'f', mime: 'text/plain', size: 1 }, now)
const rows = () => db.select().from(objectDeletions).all()
const fail = async () => {
  throw new Error('storage unavailable')
}

beforeEach(() => {
  db = createDb(':memory:')
  db.insert(user)
    .values([
      { id: 'a', name: 'a', email: 'a@x.dev' },
      { id: 'b', name: 'b', email: 'b@x.dev' },
    ])
    .run()
  db.insert(channels).values({ id: 't', type: 'text', name: 't' }).run()
})
afterEach(() => {
  db.$client.close()
  vi.restoreAllMocks()
})

describe('durable object deletions', () => {
  it.each(['message', 'channel', 'cancel', 'sound', 'avatar'])('retains failed %s deletion and clears it after a successful sweep', async path => {
    let key: string
    if (path === 'avatar') {
      db.update(user).set({ avatarKey: 'old' }).where(eq(user.id, 'a')).run()
      key = replaceAvatar(db, 'a', 'new', now)!
      expect(db.select().from(user).where(eq(user.id, 'a')).get()?.avatarKey).toBe('new')
    } else if (path === 'sound') {
      db.insert(sounds).values({ id: 's', name: 's', icon: 'bell', r2Key: 'sounds/s', durationMs: 100, size: 100, createdBy: 'a' }).run()
      key = deleteSound(db, 's', now)!
      expect(db.select().from(sounds).all()).toEqual([])
    } else {
      const file = pending()
      key = file.r2Key
      if (path === 'cancel') cancelPending(db, 'a', file.id, now)
      else {
        const message = createMessage(db, 'a', 't', 'body', now, { attachments: [{ id: file.id }] })
        if (path === 'channel') deleteChannel(db, 't', now)
        else deleteMessage(db, 'a', false, message.id, now)
      }
      expect(db.select().from(attachments).all()).toEqual([])
    }
    expect(rows().map(r => r.key)).toEqual([key])
    expect((await retryObjectDeletions(db, fail, now, [key])).failed).toEqual([key])
    expect(rows()).toHaveLength(1)
    const deleted = new Set<string>()
    expect(
      await retryObjectDeletions(
        db,
        async k => {
          deleted.add(k)
        },
        due,
      ),
    ).toMatchObject({ attempted: 1, completed: 1, failed: [] })
    expect(deleted.has(key)).toBe(true)
    expect(rows()).toEqual([])
  })

  it('keeps cancelled cleanup after an early delete and removes a late upload at the deadline', async () => {
    const file = pending()
    const objects = new Set([file.r2Key])
    cancelPending(db, 'a', file.id, now)
    const del = async (key: string) => {
      objects.delete(key)
    }
    expect((await retryObjectDeletions(db, del, now, [file.r2Key])).completed).toBe(0)
    expect(objects.size).toBe(0)
    objects.add(file.r2Key)
    expect((await retryObjectDeletions(db, del, due - 1)).attempted).toBe(0)
    expect(objects.size).toBe(1)
    await retryObjectDeletions(db, del, due)
    expect(objects.size).toBe(0)
    expect(rows()).toEqual([])
  })

  it('does not shorten duplicate deadlines or acknowledge an extension during DELETE', async () => {
    enqueueObjectDeletion(db, 'key', due)
    enqueueObjectDeletion(db, 'key', now)
    expect(rows()[0]!.notBefore.getTime()).toBe(due)
    await retryObjectDeletions(
      db,
      async key => {
        enqueueObjectDeletion(db, key, due + 1)
      },
      due,
    )
    expect(rows()[0]!.notBefore.getTime()).toBe(due + 1)
  })

  it('continues after failure and safely retries already absent objects after lost acknowledgement', async () => {
    for (const key of ['bad', 'absent']) enqueueObjectDeletion(db, key, now)
    const result = await retryObjectDeletions(
      db,
      async key => {
        if (key === 'bad') await fail()
      },
      now,
    )
    expect(result).toEqual({ attempted: 2, completed: 1, failed: ['bad'] })
    expect(rows().map(r => r.key)).toEqual(['bad'])
    await retryObjectDeletions(db, async () => {}, now)
    expect(rows()).toEqual([])
  })

  it('rolls back the app deletion when queue insertion fails', () => {
    const file = pending()
    db.run(sql`CREATE TRIGGER fail_queue BEFORE INSERT ON object_deletions BEGIN SELECT RAISE(ABORT, 'queue failed'); END`)
    expect(() => cancelPending(db, 'a', file.id, now)).toThrow()
    expect(db.select().from(attachments).all()).toHaveLength(1)
    expect(rows()).toEqual([])
  })

  it('does not enqueue unauthorized operations or the active avatar', () => {
    const file = pending()
    expect(cancelPending(db, 'b', file.id, now)).toBeNull()
    const message = createMessage(db, 'a', 't', 'body', now, { attachments: [{ id: file.id }] })
    expect(() => deleteMessage(db, 'b', false, message.id, now)).toThrow()
    expect(cancelPending(db, 'a', file.id, now)).toBeNull()
    replaceAvatar(db, 'a', 'first', now)
    expect(replaceAvatar(db, 'a', 'first', now)).toBeNull()
    expect(rows()).toEqual([])
    replaceAvatar(db, 'a', 'second', now)
    replaceAvatar(db, 'a', 'third', now)
    expect(
      rows()
        .map(r => r.key)
        .sort(),
    ).toEqual(['first', 'second'])
  })

  it('survives database close and reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spk-deletions-'))
    let disk: Db | undefined
    try {
      const path = join(dir, 'test.db')
      disk = createDb(path)
      enqueueObjectDeletion(disk, 'persisted', now)
      disk.$client.close()
      disk = createDb(path)
      expect(disk.select().from(objectDeletions).all()).toHaveLength(1)
      expect((await retryObjectDeletions(disk, async () => {}, now)).completed).toBe(1)
    } finally {
      disk?.$client.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats an actual R2 404 response as successful deletion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    try {
      enqueueObjectDeletion(db, 'absent', now)
      const result = await retryObjectDeletions(
        db,
        key => r2Delete({ accountId: 'test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test' }, key),
        now,
      )
      expect(result.completed).toBe(1)
      expect(rows()).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
