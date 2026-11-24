import type { Db } from './client'

import { eq, ne, sql } from 'drizzle-orm'

import { BOT_ID } from '../../shared/utils/bot'

import { channels, user } from './schema'

/** Default channels on first start. */
export function seedChannels(db: Db) {
  if (db.select().from(channels).limit(1).get()) return
  db.insert(channels)
    .values([
      { id: crypto.randomUUID(), type: 'text', name: 'general', position: 0 },
      { id: crypto.randomUUID(), type: 'voice', name: 'General', position: 0 },
    ])
    .run()
}

export const hasUsers = (db: Db) =>
  (db
    .select({ n: sql<number>`count(*)` })
    .from(user)
    .where(ne(user.id, BOT_ID))
    .get()?.n ?? 0) > 0

/** The bot user; no account row, so nobody can sign in as it. */
export function seedBot(db: Db) {
  db.insert(user).values({ id: BOT_ID, name: 'spk', displayName: 'spk', email: 'bot@spk.invalid' }).onConflictDoNothing().run()
  if (!db.select({ id: user.id }).from(user).where(eq(user.id, BOT_ID)).get()) console.warn('[spk] Could not create the bot user: the name "spk" is taken.')
}
