import type { Db } from './client'

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import { and, eq, inArray, lt } from 'drizzle-orm'

import { ChatError } from './messages'
import { isAdminRole } from './roles'
import { channelMembers, channels, messages, webhooks } from './schema'
import { cleanNameIcon } from './sounds'

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')
const newSecret = () => randomBytes(24).toString('base64url')

const dto = (c: { id: string; name: string | null }, icon: string, ownerId: string, priv: boolean) => ({
  id: c.id,
  type: 'webhook' as const,
  name: c.name,
  icon,
  ownerId,
  private: priv,
})

const setMember = (db: Pick<Db, 'insert' | 'delete'>, id: string, ownerId: string, priv: boolean) => {
  if (priv) db.insert(channelMembers).values({ channelId: id, userId: ownerId }).onConflictDoNothing().run()
  else db.delete(channelMembers).where(eq(channelMembers.channelId, id)).run()
}

export function createWebhook(db: Db, ownerId: string, input: { name?: unknown; icon?: unknown; private?: unknown }) {
  const { name, icon } = cleanNameIcon(input)
  const priv = input.private === true
  const id = randomUUID(),
    secret = newSecret()
  db.transaction(tx => {
    tx.insert(channels).values({ id, type: 'webhook', name }).run()
    tx.insert(webhooks)
      .values({ channelId: id, ownerId, icon, secretHash: hash(secret) })
      .run()
    setMember(tx, id, ownerId, priv)
  })
  return { channel: dto({ id, name }, icon, ownerId, priv), secret }
}

/** Owner or admin. Other users' private feeds are invisible, so they're a 404 even for admins. */
function manageable(db: Db, actor: { id: string; role?: string | null }, id: unknown) {
  const w =
    typeof id === 'string'
      ? db
          .select({ id: channels.id, name: channels.name, icon: webhooks.icon, ownerId: webhooks.ownerId })
          .from(webhooks)
          .innerJoin(channels, eq(channels.id, webhooks.channelId))
          .where(eq(webhooks.channelId, id))
          .get()
      : undefined
  const priv = !!w && !!db.select().from(channelMembers).where(eq(channelMembers.channelId, w.id)).get()
  if (!w || (priv && w.ownerId !== actor.id)) throw new ChatError(404, 'Webhook not found')
  if (w.ownerId !== actor.id && !isAdminRole(actor.role)) throw new ChatError(403, 'Not your webhook')
  return { ...w, priv }
}

export function updateWebhook(db: Db, actor: { id: string; role?: string | null }, id: unknown, input: { name?: unknown; icon?: unknown; private?: unknown }) {
  const w = manageable(db, actor, id)
  const { name, icon } = cleanNameIcon({ name: input.name ?? w.name, icon: input.icon ?? w.icon })
  const priv = input.private === undefined ? w.priv : input.private === true
  db.transaction(tx => {
    tx.update(channels).set({ name }).where(eq(channels.id, w.id)).run()
    tx.update(webhooks).set({ icon }).where(eq(webhooks.channelId, w.id)).run()
    setMember(tx, w.id, w.ownerId, priv)
  })
  return dto({ id: w.id, name }, icon, w.ownerId, priv)
}

/** Returns the new secret; the old one stops working at once. */
export function regenerateSecret(db: Db, actor: { id: string; role?: string | null }, id: unknown) {
  const w = manageable(db, actor, id)
  const secret = newSecret()
  db.update(webhooks)
    .set({ secretHash: hash(secret) })
    .where(eq(webhooks.channelId, w.id))
    .run()
  return secret
}

export function deleteWebhook(db: Db, actor: { id: string; role?: string | null }, id: unknown) {
  const w = manageable(db, actor, id)
  db.delete(channels).where(eq(channels.id, w.id)).run()
  return { id: w.id }
}

/** Null for an unknown id or a wrong secret (callers answer both with 404). */
export function verifyWebhook(db: Db, id: string, secret: string) {
  const w = db
    .select({ channelId: webhooks.channelId, ownerId: webhooks.ownerId, h: webhooks.secretHash })
    .from(webhooks)
    .where(eq(webhooks.channelId, id))
    .get()
  const a = Buffer.from(hash(secret)),
    b = Buffer.from(w?.h ?? '')
  return w && a.length === b.length && timingSafeEqual(a, b) ? { channelId: w.channelId, ownerId: w.ownerId } : null
}

const WEBHOOK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Deletes webhook-feed messages older than 30 days (mentions, attachments rows, pins and reactions cascade). Returns the count. */
export function pruneWebhookMessages(db: Db, now = Date.now()) {
  const old = db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(and(eq(channels.type, 'webhook'), lt(messages.createdAt, new Date(now - WEBHOOK_RETENTION_MS))))
  return db.delete(messages).where(inArray(messages.id, old)).run().changes
}
