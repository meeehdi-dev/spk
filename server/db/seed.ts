import type { Db } from './client'

import { sql } from 'drizzle-orm'

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
    .get()?.n ?? 0) > 0
