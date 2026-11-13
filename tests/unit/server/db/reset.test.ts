import type { Db } from '~~/server/db/client'

import { describe, expect } from 'vitest'

import { checkResetToken, createResetToken, RESET_TTL_MS, resetPassword } from '~~/server/db/reset'
import { account, pushSubscriptions, session, verification } from '~~/server/db/schema'
import { addUser, test } from '~~/tests/fixtures/db'

const addCred = (db: Db) => db.insert(account).values({ id: 'acc', accountId: 'b', providerId: 'credential', userId: 'b', password: 'old' }).run()

test.beforeEach(({ db }) => {
  addUser(db, 'a', { role: 'admin' })
  addUser(db, 'b')
})

describe('reset password link', () => {
  test('stores only a hash and works exactly once, signing the user out', ({ db }) => {
    addCred(db)
    db.insert(session)
      .values({ id: 's-b', token: 't-b', userId: 'b', expiresAt: new Date(Date.now() + 1e6) })
      .run()
    for (const userId of ['b', 'a'])
      db.insert(pushSubscriptions)
        .values({ userId, endpoint: `e-${userId}`, keys: '{}' })
        .run()
    const token = createResetToken(db, 'b')
    expect(db.select().from(verification).get()!.identifier).not.toContain(token)
    expect(checkResetToken(db, token)).toBe(true)
    expect(resetPassword(db, token, 'new-hash')).toBe('b')
    expect(db.select().from(account).get()!.password).toBe('new-hash')
    expect(db.select().from(session).all()).toHaveLength(0)
    expect(
      db
        .select()
        .from(pushSubscriptions)
        .all()
        .map(p => p.userId),
    ).toEqual(['a'])
    expect(resetPassword(db, token, 'again')).toBe(false)
    expect(checkResetToken(db, token)).toBe(false)
    expect(db.select().from(account).get()!.password).toBe('new-hash')
  })
  test('expires, and a newer link replaces the older one', ({ db }) => {
    addCred(db)
    const t1 = createResetToken(db, 'b', 0)
    expect(checkResetToken(db, t1, RESET_TTL_MS - 1)).toBe(true)
    expect(resetPassword(db, t1, 'x', RESET_TTL_MS)).toBe(false)
    const t2 = createResetToken(db, 'b')
    const t3 = createResetToken(db, 'b')
    expect(checkResetToken(db, t2)).toBe(false)
    expect(checkResetToken(db, t3)).toBe(true)
  })
  test('refuses unknown users and unknown tokens', ({ db }) => {
    expect(() => createResetToken(db, 'nope')).toThrow(/not found/)
    expect(resetPassword(db, 'bogus', 'x')).toBe(false)
  })
  test('keeps the token when the account has no password to reset', ({ db }) => {
    const token = createResetToken(db, 'b')
    expect(() => resetPassword(db, token, 'x')).toThrow(/no password/)
    expect(checkResetToken(db, token)).toBe(true)
  })
})
