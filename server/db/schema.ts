import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' })
const now = sql`(unixepoch() * 1000)`

// --- better-auth tables (`user` is the plan's `users`; `name` is unused, the nickname is display_name) ---
export const user = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: ts('created_at').notNull().default(now),
    updatedAt: ts('updated_at').notNull().default(now),
    role: text('role').notNull().default('user'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: ts('ban_expires'),
    displayName: text('display_name'),
    avatarKey: text('avatar_key'),
  },
  t => [uniqueIndex('users_display_name_nocase').on(sql`lower(${t.displayName})`)],
)

export const session = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().default(now),
    updatedAt: ts('updated_at').notNull().default(now),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  t => [index('sessions_user').on(t.userId)],
)

export const account = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().default(now),
    updatedAt: ts('updated_at').notNull().default(now),
  },
  t => [index('accounts_user').on(t.userId)],
)

export const verification = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().default(now),
    updatedAt: ts('updated_at').notNull().default(now),
  },
  t => [index('verifications_identifier').on(t.identifier)],
)

// --- app tables ---
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  note: text('note'),
  // null = created by the system at startup (first-admin invite)
  createdBy: text('created_by').references(() => user.id),
  createdAt: ts('created_at').notNull().default(now),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  usedBy: text('used_by').references(() => user.id),
  revokedAt: ts('revoked_at'),
})

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['text', 'voice', 'dm'] }).notNull(),
  name: text('name'),
  lastActivityAt: ts('last_activity_at'),
  position: integer('position'),
  createdAt: ts('created_at').notNull().default(now),
})

export const sounds = sqliteTable('sounds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  r2Key: text('r2_key').notNull(),
  durationMs: integer('duration_ms').notNull(),
  size: integer('size').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: ts('created_at').notNull().default(now),
})

export const channelMembers = sqliteTable(
  'channel_members',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
  },
  t => [primaryKey({ columns: [t.channelId, t.userId] })],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    body: text('body').notNull(),
    replyToId: text('reply_to_id'),
    createdAt: ts('created_at').notNull().default(now),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    suppressPreviews: integer('suppress_previews', { mode: 'boolean' }).notNull().default(false),
  },
  t => [index('messages_channel_created').on(t.channelId, t.createdAt)],
)

export const messageMentions = sqliteTable(
  'message_mentions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
  },
  t => [primaryKey({ columns: [t.messageId, t.userId] })],
)

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  uploaderId: text('uploader_id')
    .notNull()
    .references(() => user.id),
  r2Key: text('r2_key').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  spoiler: integer('spoiler', { mode: 'boolean' }).notNull().default(false),
  createdAt: ts('created_at').notNull().default(now),
})

export const reactions = sqliteTable(
  'reactions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    emoji: text('emoji').notNull(),
  },
  t => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
)

export const linkPreviews = sqliteTable('link_previews', {
  url: text('url').primaryKey(),
  title: text('title'),
  description: text('description'),
  siteName: text('site_name'),
  imageKey: text('image_key'),
  fetchedAt: ts('fetched_at').notNull(),
})

/** Which cached previews a message shows (removing one deletes only this row). */
export const messagePreviews = sqliteTable(
  'message_previews',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    url: text('url')
      .notNull()
      .references(() => linkPreviews.url, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  t => [primaryKey({ columns: [t.messageId, t.url] })],
)

export const channelReads = sqliteTable(
  'channel_reads',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadAt: ts('last_read_at').notNull(),
  },
  t => [primaryKey({ columns: [t.userId, t.channelId] })],
)

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  endpoint: text('endpoint').primaryKey(),
  keys: text('keys').notNull(),
  // The browser's notification settings ({dms, pings, dnd, muted[]}), so the server never pushes what the client would hide.
  prefs: text('prefs').notNull().default('{}'),
})

export const objectDeletions = sqliteTable(
  'object_deletions',
  {
    key: text('key').primaryKey(),
    createdAt: ts('created_at').notNull().default(now),
    notBefore: ts('not_before').notNull(),
  },
  t => [index('object_deletions_due').on(t.notBefore)],
)

export const radioFavorites = sqliteTable(
  'radio_favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    stationId: text('station_id').notNull(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    codec: text('codec').notNull(),
  },
  t => [primaryKey({ columns: [t.userId, t.stationId] })],
)
