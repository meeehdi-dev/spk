import { eq } from 'drizzle-orm'
import { describe, expect, vi } from 'vitest'

import { user } from '~~/server/db/schema'
import { hasUsers, seedBot } from '~~/server/db/seed'
import { BOT_ID } from '~~/shared/utils/bot'
import { addUser, test } from '~~/tests/fixtures/db'

describe('seedBot', () => {
  test('inserts the bot once', ({ db }) => {
    seedBot(db)
    seedBot(db)
    expect(db.select().from(user).where(eq(user.id, BOT_ID)).all()).toHaveLength(1)
  })
  test('warns when a human already took the name', ({ db }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    addUser(db, 'h', { displayName: 'SPK' })
    seedBot(db)
    expect(db.select().from(user).where(eq(user.id, BOT_ID)).get()).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  test('hasUsers ignores the bot', ({ db }) => {
    seedBot(db)
    expect(hasUsers(db)).toBe(false)
    addUser(db, 'h')
    expect(hasUsers(db)).toBe(true)
  })
})
