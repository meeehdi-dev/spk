import type { Db } from '~~/server/db/client'

import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import { listUsersWithStorage, setBanned, setRole } from '~~/server/db/admin'
import { createMessage } from '~~/server/db/messages'
import { attachments, messages, pushSubscriptions, session, user } from '~~/server/db/schema'
import { addChannel, addUser, test } from '~~/tests/fixtures/db'

const addPush = (db: Db, userId: string) =>
  db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: `e-${userId}`, keys: '{}' })
    .run()
const addSession = (db: Db, userId: string) =>
  db
    .insert(session)
    .values({ id: `s-${userId}`, token: `t-${userId}`, userId, expiresAt: new Date(Date.now() + 1e6) })
    .run()

test.beforeEach(({ db }) => {
  addUser(db, 'a', { role: 'admin' })
  addUser(db, 'b')
  addUser(db, 'c', { role: 'admin' })
})

describe('setRole', () => {
  test('changes a role and rejects bad input or unknown users', ({ db }) => {
    setRole(db, 'b', 'admin')
    expect(db.select().from(user).where(eq(user.id, 'b')).get()!.role).toBe('admin')
    expect(() => setRole(db, 'b', 'root')).toThrow(/Role/)
    expect(() => setRole(db, 'zzz', 'user')).toThrow(/not found/)
  })
  test('the last admin cannot be demoted; a banned admin does not count as another admin', ({ db }) => {
    setRole(db, 'c', 'user')
    expect(() => setRole(db, 'a', 'user')).toThrow(/last admin/)
    setRole(db, 'c', 'admin')
    setBanned(db, 'a', 'c', true)
    expect(() => setRole(db, 'a', 'user')).toThrow(/last admin/)
  })
})

describe('setBanned', () => {
  test('flags the user, deletes their sessions, keeps their messages, and can be undone', ({ db }) => {
    addChannel(db, 't')
    createMessage(db, 'b', 't', 'hi', 1000)
    addSession(db, 'b')
    addSession(db, 'a')
    addPush(db, 'b')
    addPush(db, 'a')
    setBanned(db, 'a', 'b', true, ' spam ')
    expect(
      db
        .select()
        .from(pushSubscriptions)
        .all()
        .map(p => p.userId),
    ).toEqual(['a'])
    const u = db.select().from(user).where(eq(user.id, 'b')).get()!
    expect(u).toMatchObject({ banned: true, banReason: 'spam' })
    expect(
      db
        .select()
        .from(session)
        .all()
        .map(s => s.userId),
    ).toEqual(['a'])
    expect(db.select().from(messages).all()).toHaveLength(1)
    setBanned(db, 'a', 'b', false)
    expect(db.select().from(user).where(eq(user.id, 'b')).get()).toMatchObject({ banned: false, banReason: null })
  })
  test("you can't ban yourself, or someone who doesn't exist", ({ db }) => {
    expect(() => setBanned(db, 'a', 'a', true)).toThrow(/yourself/)
    expect(() => setBanned(db, 'a', 'nope', true)).toThrow(/not found/)
  })
})

describe('listUsersWithStorage', () => {
  test('sums attachments per uploader', ({ db }) => {
    db.insert(attachments)
      .values([
        { id: '1', uploaderId: 'b', r2Key: 'k1', filename: 'a', mime: 'x/y', size: 100 },
        { id: '2', uploaderId: 'b', r2Key: 'k2', filename: 'a', mime: 'x/y', size: 50 },
      ])
      .run()
    const r = listUsersWithStorage(db)
    expect(r.totalBytes).toBe(150)
    expect(r.users.find(u => u.id === 'b')!.bytes).toBe(150)
    expect(r.users.find(u => u.id === 'a')!.bytes).toBe(0)
  })
})
