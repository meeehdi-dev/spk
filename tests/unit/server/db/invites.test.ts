import { describe, expect } from 'vitest'

import { checkInvite, claimInvite, createInvite, hashToken, linkInviteUser, releaseInvite, revokeInvite } from '~~/server/db/invites'
import { invites } from '~~/server/db/schema'
import { addUser, test } from '~~/tests/fixtures/db'

test.beforeEach(({ db }) => addUser(db, 'a', { role: 'admin' }))

describe('invites', () => {
  test('stores only a hash and reports active', ({ db }) => {
    const { token } = createInvite(db, { createdBy: 'a' })
    expect(db.select().from(invites).get()!.tokenHash).toBe(hashToken(token))
    expect(checkInvite(db, token)).toBe('active')
    expect(checkInvite(db, 'nope')).toBe('invalid')
  })

  test('expires after exactly 5 minutes', ({ db }) => {
    const { token } = createInvite(db, { createdBy: 'a' }, 0)
    expect(checkInvite(db, token, 299_999)).toBe('active')
    expect(checkInvite(db, token, 300_000)).toBe('expired')
    expect(claimInvite(db, token, 300_000)).toBe(false)
  })

  test('is single use and can be released when sign-up fails', ({ db }) => {
    const { token } = createInvite(db, { createdBy: 'a' })
    expect(claimInvite(db, token)).toBe(true)
    expect(claimInvite(db, token)).toBe(false)
    expect(checkInvite(db, token)).toBe('used')
    releaseInvite(db, token)
    expect(checkInvite(db, token)).toBe('active')
    expect(claimInvite(db, token)).toBe(true)
  })

  test('does not release an invite already linked to an account', ({ db }) => {
    const { token } = createInvite(db, { createdBy: 'a' })
    claimInvite(db, token)
    addUser(db, 'b')
    expect(linkInviteUser(db, token, 'b')).toBe('a')
    releaseInvite(db, token)
    expect(checkInvite(db, token)).toBe('used')
  })

  test('revoke only works on active invites and blocks claiming', ({ db }) => {
    const { id, token } = createInvite(db, { createdBy: 'a' })
    expect(revokeInvite(db, id)).toBe(true)
    expect(revokeInvite(db, id)).toBe(false)
    expect(checkInvite(db, token)).toBe('revoked')
    expect(claimInvite(db, token)).toBe(false)
  })

  test('system invite has no creator', ({ db }) => {
    const { token } = createInvite(db, { createdBy: null })
    claimInvite(db, token)
    addUser(db, 'first')
    expect(linkInviteUser(db, token, 'first')).toBeNull()
  })
})
