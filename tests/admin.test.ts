import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { listUsersWithStorage, setBanned, setRole } from '../server/db/admin'
import { createChannel, deleteChannel, renameChannel, reorderChannels } from '../server/db/channelsAdmin'
import { createDb, type Db } from '../server/db/client'
import { createMessage } from '../server/db/messages'
import { checkResetToken, createResetToken, resetPassword, RESET_TTL_MS } from '../server/db/reset'
import { isAdminRole } from '../server/db/roles'
import { account, attachments, channels, messages, session, user, verification } from '../server/db/schema'
import { dropVoiceOwner, joinVoice, sessionOf, sessionsIn } from '../server/utils/voicePresence'

let db: Db
const addUser = (id: string, role = 'user') =>
  db
    .insert(user)
    .values({ id, name: id, email: `${id}@x.dev`, role, displayName: id })
    .run()
const addSession = (userId: string) =>
  db
    .insert(session)
    .values({ id: `s-${userId}`, token: `t-${userId}`, userId, expiresAt: new Date(Date.now() + 1e6) })
    .run()

beforeEach(() => {
  db = createDb(':memory:')
  addUser('a', 'admin')
  addUser('b')
  addUser('c', 'admin')
})

describe('admin gate', () => {
  it('only the admin role passes (routes call requireAdmin → isAdminRole)', () => {
    expect(isAdminRole('admin')).toBe(true)
    for (const r of ['user', '', null, undefined, 'Admin']) expect(isAdminRole(r)).toBe(false)
  })
})

describe('roles', () => {
  it('changes a role and rejects bad input or unknown users', () => {
    setRole(db, 'b', 'admin')
    expect(db.select().from(user).where(eq(user.id, 'b')).get()!.role).toBe('admin')
    expect(() => setRole(db, 'b', 'root')).toThrow(/Role/)
    expect(() => setRole(db, 'zzz', 'user')).toThrow(/not found/)
  })
  it('the last admin cannot be demoted; a banned admin does not count as another admin', () => {
    setRole(db, 'c', 'user')
    expect(() => setRole(db, 'a', 'user')).toThrow(/last admin/)
    setRole(db, 'c', 'admin')
    setBanned(db, 'a', 'c', true)
    expect(() => setRole(db, 'a', 'user')).toThrow(/last admin/)
  })
})

describe('ban', () => {
  it('flags the user, deletes their sessions, keeps their messages, and can be undone', () => {
    db.insert(channels).values({ id: 't', type: 'text', name: 't' }).run()
    createMessage(db, 'b', 't', 'hi', 1000)
    addSession('b')
    addSession('a')
    setBanned(db, 'a', 'b', true, ' spam ')
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
  it("you can't ban yourself, or someone who doesn't exist", () => {
    expect(() => setBanned(db, 'a', 'a', true)).toThrow(/yourself/)
    expect(() => setBanned(db, 'a', 'nope', true)).toThrow(/not found/)
  })
})

describe('reset password link', () => {
  const addCred = () => db.insert(account).values({ id: 'acc', accountId: 'b', providerId: 'credential', userId: 'b', password: 'old' }).run()
  it('stores only a hash and works exactly once, signing the user out', () => {
    addCred()
    addSession('b')
    const token = createResetToken(db, 'b')
    expect(db.select().from(verification).get()!.identifier).not.toContain(token)
    expect(checkResetToken(db, token)).toBe(true)
    expect(resetPassword(db, token, 'new-hash')).toBe(true)
    expect(db.select().from(account).get()!.password).toBe('new-hash')
    expect(db.select().from(session).all()).toHaveLength(0)
    expect(resetPassword(db, token, 'again')).toBe(false)
    expect(checkResetToken(db, token)).toBe(false)
    expect(db.select().from(account).get()!.password).toBe('new-hash')
  })
  it('expires, and a newer link replaces the older one', () => {
    addCred()
    const t1 = createResetToken(db, 'b', 0)
    expect(checkResetToken(db, t1, RESET_TTL_MS - 1)).toBe(true)
    expect(resetPassword(db, t1, 'x', RESET_TTL_MS)).toBe(false)
    const t2 = createResetToken(db, 'b')
    const t3 = createResetToken(db, 'b')
    expect(checkResetToken(db, t2)).toBe(false)
    expect(checkResetToken(db, t3)).toBe(true)
  })
  it('refuses unknown users and unknown tokens', () => {
    expect(() => createResetToken(db, 'nope')).toThrow(/not found/)
    expect(resetPassword(db, 'bogus', 'x')).toBe(false)
  })
  it('keeps the token when the account has no password to reset', () => {
    const token = createResetToken(db, 'b')
    expect(() => resetPassword(db, token, 'x')).toThrow(/no password/)
    expect(checkResetToken(db, token)).toBe(true)
  })
})

describe('channels', () => {
  it('creates at the end of its section, renames, validates', () => {
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
  it("DMs can't be renamed or deleted", () => {
    db.insert(channels).values({ id: 'dm', type: 'dm' }).run()
    expect(() => renameChannel(db, 'dm', 'x')).toThrow(/not found/)
    expect(() => deleteChannel(db, 'dm')).toThrow(/not found/)
  })
  it('reorders by saving positions; stale or foreign lists are refused', () => {
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
  it('delete removes messages and returns their file keys; the search index stays consistent', () => {
    const ch = createChannel(db, 'text', 'gone')
    const m = createMessage(db, 'b', ch.id, 'findme', 1000)
    db.insert(attachments).values({ id: 'f', messageId: m.id, uploaderId: 'b', r2Key: 'attachments/b/f', filename: 'f', mime: 'text/plain', size: 5 }).run()
    const r = deleteChannel(db, ch.id)
    expect(r.r2Keys).toEqual(['attachments/b/f'])
    expect(db.select().from(messages).all()).toHaveLength(0)
    expect(db.select().from(attachments).all()).toHaveLength(0)
  })
})

describe('storage total', () => {
  it('sums attachments per uploader', () => {
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

describe('voice sessions for admin actions', () => {
  it('finds a user’s session and a channel’s members', () => {
    const o = {}
    joinVoice('b', 'v1', 'sid-b', o)
    joinVoice('a', 'v1', 'sid-a', o)
    joinVoice('c', 'v2', 'sid-c', o)
    expect(sessionOf('b')).toEqual({ sid: 'sid-b', channelId: 'v1' })
    expect(
      sessionsIn('v1')
        .map(s => s.userId)
        .sort(),
    ).toEqual(['a', 'b'])
    dropVoiceOwner(o)
    expect(sessionOf('b')).toBeNull()
  })
})
