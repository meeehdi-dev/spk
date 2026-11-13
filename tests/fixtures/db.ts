import { test as base } from 'vitest'

import { createDb, type Db } from '~~/server/db/client'
import { channelMembers, channels, user } from '~~/server/db/schema'

export const test = base.extend<{ db: Db }>({
  db: async ({}, use) => {
    const db = createDb(':memory:')
    await use(db)
    db.$client.close()
  },
})

export function addUser(db: Db, id: string, values: Partial<typeof user.$inferInsert> = {}) {
  db.insert(user)
    .values({ id, name: id, email: `${id}@x.dev`, displayName: id, ...values })
    .run()
}

export function addChannel(db: Db, id: string, values: Partial<typeof channels.$inferInsert> = {}, members: string[] = []) {
  db.insert(channels)
    .values({ id, type: 'text', name: id, ...values })
    .run()
  if (members.length)
    db.insert(channelMembers)
      .values(members.map(userId => ({ channelId: id, userId })))
      .run()
}

/** Users a, b, c; text channel t; DM dm between a and b. */
export function seedChat(db: Db) {
  for (const id of ['a', 'b', 'c']) addUser(db, id)
  addChannel(db, 't')
  addChannel(db, 'dm', { type: 'dm', name: null }, ['a', 'b'])
}
