import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import { createChannel, deleteChannel, renameChannel, reorderChannels } from '~~/server/db/channelsAdmin'
import { listChannelsFor } from '~~/server/db/dms'
import { accessibleChannel, channelMemberIds, createMessage, editMessage, setReaction, setVote } from '~~/server/db/messages'
import { setPin } from '~~/server/db/pins'
import { pushJobs, savePush } from '~~/server/db/push'
import { allUnread, firstUnreadId } from '~~/server/db/reads'
import { channelMembers, channels, messages, webhooks } from '~~/server/db/schema'
import { searchMessages } from '~~/server/db/search'
import { createWebhook, deleteWebhook, pruneWebhookMessages, regenerateSecret, updateWebhook, verifyWebhook } from '~~/server/db/webhooks'
import { addChannel, addUser, test } from '~~/tests/fixtures/db'

// Owner "a"; "priv" has an owner member row, "pub" has none.
test.beforeEach(({ db }) => {
  for (const id of ['a', 'b']) addUser(db, id)
  addChannel(db, 'priv', { type: 'webhook', name: 'Private feed' }, ['a'])
  addChannel(db, 'pub', { type: 'webhook', name: 'Public feed' })
  for (const id of ['priv', 'pub'])
    db.insert(webhooks)
      .values({ channelId: id, ownerId: 'a', icon: 'bell', secretHash: `h-${id}` })
      .run()
})

const post = (db: Parameters<typeof createMessage>[0], ch: string, body = 'deploy done') =>
  createMessage(db, 'a', ch, body, Date.now() + 1000, { asWebhook: true, embed: { title: 'Deploy', color: 'success' } })

describe('webhook access', () => {
  test('private is hidden from non-owners, public is open to all', ({ db }) => {
    expect(accessibleChannel(db, 'a', 'priv')).toBeTruthy()
    expect(accessibleChannel(db, 'b', 'priv')).toBeNull()
    expect(accessibleChannel(db, 'b', 'pub')).toBeTruthy()
    expect(channelMemberIds(db, { id: 'priv', type: 'webhook' }, ['a', 'b'])).toEqual(['a'])
    expect(channelMemberIds(db, { id: 'pub', type: 'webhook' }, ['a', 'b'])).toEqual(['a', 'b'])
  })
  test('listing returns visible feeds with icon, owner and private', ({ db }) => {
    const feeds = (u: string) => listChannelsFor(db, u).filter(c => c.type === 'webhook')
    expect(feeds('a')).toMatchObject([
      { id: 'priv', icon: 'bell', ownerId: 'a', private: true },
      { id: 'pub', private: false },
    ])
    expect(feeds('b').map(c => c.id)).toEqual(['pub'])
  })
  test('search and unread follow the same rules; the owner is notified of their own feed', ({ db }) => {
    post(db, 'priv')
    post(db, 'pub')
    const hits = (u: string) =>
      searchMessages(db, u, { q: 'deploy' })
        .results.map(r => r.channelId)
        .sort()
    expect(hits('a')).toEqual(['priv', 'pub'])
    expect(hits('b')).toEqual(['pub'])
    expect(allUnread(db, 'a')).toMatchObject({ priv: { unread: 1 }, pub: { unread: 1 } })
    expect(Object.keys(allUnread(db, 'b'))).toEqual(['pub'])
    expect(firstUnreadId(db, 'a', 'priv')).toBeTruthy()
  })
})

describe('webhook feeds are read-only', () => {
  test('users cannot post; asWebhook posts with an embed', ({ db }) => {
    expect(() => createMessage(db, 'a', 'priv', 'hi')).toThrow(/read-only/)
    expect(() => createMessage(db, 'b', 'pub', 'hi')).toThrow(/read-only/)
    expect(() => createMessage(db, 'a', 't-none', 'hi', Date.now(), { asWebhook: true })).toThrow()
    expect(post(db, 'pub').embed).toEqual({ title: 'Deploy', color: 'success' })
  })
  test('asWebhook and embeds are refused in normal channels', ({ db }) => {
    addChannel(db, 't')
    expect(() => createMessage(db, 'a', 't', 'x', Date.now(), { asWebhook: true })).toThrow()
    expect(() => createMessage(db, 'a', 't', 'x', Date.now(), { embed: { title: 'x' } })).toThrow()
  })
  test('no edit, reaction, vote or pin', ({ db }) => {
    const m = post(db, 'pub')
    expect(() => editMessage(db, 'a', m.id, 'changed')).toThrow(/read-only/)
    expect(() => setReaction(db, 'b', m.id, '👍', true)).toThrow(/read-only/)
    expect(() => setVote(db, 'b', m.id, null)).toThrow(/read-only/)
    expect(() => setPin(db, 'a', 'admin', m.id, true)).toThrow()
  })
  test('no push jobs', ({ db }) => {
    savePush(db, 'b', 'https://push.example/b', { p256dh: 'k', auth: 'a' }, {})
    expect(pushJobs(db, post(db, 'pub', 'hey <@b>'), [])).toEqual([])
  })
})

describe('admin channel API', () => {
  test('cannot create, manage or reorder webhooks', ({ db }) => {
    expect(() => createChannel(db, 'webhook', 'x')).toThrow()
    expect(() => renameChannel(db, 'pub', 'x')).toThrow(/not found/)
    expect(() => deleteChannel(db, 'pub')).toThrow(/not found/)
    expect(() => reorderChannels(db, 'webhook', [])).toThrow()
    expect(
      db
        .select()
        .from(channels)
        .all()
        .filter(c => c.type === 'webhook'),
    ).toHaveLength(2)
  })
})

describe('webhook management', () => {
  const owner = { id: 'a', role: 'user' }
  const members = (db: Parameters<typeof createWebhook>[0], id: string) =>
    db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.channelId, id))
      .all()
      .map(m => m.userId)

  test('create validates and stores only a hash of the secret', ({ db }) => {
    const { channel, secret } = createWebhook(db, 'a', { name: '  Dep\u0000loy ', icon: 'bell', private: true })
    expect(channel).toMatchObject({ name: 'Deploy', icon: 'bell', ownerId: 'a', private: true })
    expect(db.select().from(webhooks).where(eq(webhooks.channelId, channel.id)).get()?.secretHash).not.toBe(secret)
    expect(members(db, channel.id)).toEqual(['a'])
    expect(verifyWebhook(db, channel.id, secret)).toEqual({ channelId: channel.id, ownerId: 'a' })
    expect(members(db, createWebhook(db, 'a', { name: 'x', icon: 'bell', private: false }).channel.id)).toEqual([])
    for (const bad of [{ name: ' ', icon: 'bell' }, { name: 'x'.repeat(33), icon: 'bell' }, { name: 'x', icon: 'Bad Icon' }, { name: 'x' }])
      expect(() => createWebhook(db, 'a', bad)).toThrow()
  })
  test('verify rejects wrong secrets and unknown ids', ({ db }) => {
    const { channel, secret } = createWebhook(db, 'a', { name: 'x', icon: 'bell' })
    expect(verifyWebhook(db, channel.id, 'nope')).toBeNull()
    expect(verifyWebhook(db, 'missing', secret)).toBeNull()
  })
  test('regenerating invalidates the old secret', ({ db }) => {
    const { channel, secret } = createWebhook(db, 'a', { name: 'x', icon: 'bell' })
    const next = regenerateSecret(db, owner, channel.id)
    expect(verifyWebhook(db, channel.id, secret)).toBeNull()
    expect(verifyWebhook(db, channel.id, next)).toBeTruthy()
  })
  test('update changes fields and keeps member rows in sync with private', ({ db }) => {
    expect(updateWebhook(db, owner, 'pub', { name: 'New', private: true })).toMatchObject({ name: 'New', icon: 'bell', private: true })
    expect(members(db, 'pub')).toEqual(['a'])
    expect(updateWebhook(db, owner, 'pub', { icon: 'zap' })).toMatchObject({ icon: 'zap', private: true })
    expect(updateWebhook(db, owner, 'pub', { private: false }).private).toBe(false)
    expect(members(db, 'pub')).toEqual([])
    expect(() => updateWebhook(db, owner, 'pub', { icon: 'BAD' })).toThrow()
  })
  test('only the owner or an admin manages; admins cannot see private feeds of others', ({ db }) => {
    const other = { id: 'b', role: 'user' }
    const admin = { id: 'b', role: 'admin' }
    expect(() => updateWebhook(db, other, 'pub', { name: 'x' })).toThrow(/Not your/)
    expect(() => regenerateSecret(db, other, 'priv')).toThrow(/not found/)
    expect(() => deleteWebhook(db, admin, 'priv')).toThrow(/not found/)
    expect(() => updateWebhook(db, admin, 'nope', {})).toThrow(/not found/)
    expect(updateWebhook(db, admin, 'pub', { name: 'Admin' }).name).toBe('Admin')
    deleteWebhook(db, admin, 'pub')
    expect(db.select().from(channels).where(eq(channels.id, 'pub')).get()).toBeUndefined()
    deleteWebhook(db, owner, 'priv')
    expect(db.select().from(webhooks).all()).toEqual([])
  })
})

describe('pruneWebhookMessages', () => {
  test('deletes only webhook messages older than 30 days', ({ db }) => {
    const day = 24 * 60 * 60 * 1000,
      now = Date.now()
    addChannel(db, 'chat', { type: 'text', name: 'general' })
    const old = post(db, 'pub', 'old'),
      fresh = post(db, 'pub', 'fresh')
    const chat = createMessage(db, 'a', 'chat', 'old chat')
    db.update(messages)
      .set({ createdAt: new Date(now - 31 * day) })
      .where(eq(messages.id, old.id))
      .run()
    db.update(messages)
      .set({ createdAt: new Date(now - 31 * day) })
      .where(eq(messages.id, chat.id))
      .run()
    expect(pruneWebhookMessages(db, now)).toBe(1)
    expect(
      db
        .select({ id: messages.id })
        .from(messages)
        .all()
        .map(m => m.id)
        .sort(),
    ).toEqual([chat.id, fresh.id].sort())
  })
})
