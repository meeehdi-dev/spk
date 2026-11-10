import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../server/db/client'
import { checkInvite, claimInvite, createInvite, hashToken, releaseInvite, revokeInvite, linkInviteUser } from '../server/db/invites'
import { invites, user } from '../server/db/schema'
import { wouldRemoveLastAdmin } from '../server/db/roles'

let db: Db
const addUser = (id: string, role = 'user') =>
  db.insert(user).values({ id, name: id, email: `${id}@x.dev`, role }).run()

beforeEach(() => {
  db = createDb(':memory:')
  addUser('a', 'admin')
})

describe('invites', () => {
  it('stores only a hash and reports active', () => {
    const { token } = createInvite(db, { createdBy: 'a' })
    expect(db.select().from(invites).get()!.tokenHash).toBe(hashToken(token))
    expect(checkInvite(db, token)).toBe('active')
    expect(checkInvite(db, 'nope')).toBe('invalid')
  })

  it('expires after exactly 5 minutes', () => {
    const { token } = createInvite(db, { createdBy: 'a' }, 0)
    expect(checkInvite(db, token, 299_999)).toBe('active')
    expect(checkInvite(db, token, 300_000)).toBe('expired')
    expect(claimInvite(db, token, 300_000)).toBe(false)
  })

  it('is single use and can be released when sign-up fails', () => {
    const { token } = createInvite(db, { createdBy: 'a' })
    expect(claimInvite(db, token)).toBe(true)
    expect(claimInvite(db, token)).toBe(false)
    expect(checkInvite(db, token)).toBe('used')
    releaseInvite(db, token)
    expect(checkInvite(db, token)).toBe('active')
    expect(claimInvite(db, token)).toBe(true)
  })

  it('does not release an invite already linked to an account', () => {
    const { token } = createInvite(db, { createdBy: 'a' })
    claimInvite(db, token)
    addUser('b')
    expect(linkInviteUser(db, token, 'b')).toBe('a')
    releaseInvite(db, token)
    expect(checkInvite(db, token)).toBe('used')
  })

  it('revoke only works on active invites and blocks claiming', () => {
    const { id, token } = createInvite(db, { createdBy: 'a' })
    expect(revokeInvite(db, id)).toBe(true)
    expect(revokeInvite(db, id)).toBe(false)
    expect(checkInvite(db, token)).toBe('revoked')
    expect(claimInvite(db, token)).toBe(false)
  })

  it('system invite has no creator', () => {
    const { token } = createInvite(db, { createdBy: null })
    claimInvite(db, token)
    addUser('first')
    expect(linkInviteUser(db, token, 'first')).toBeNull()
  })
})

describe('roles', () => {
  it('the last admin cannot be demoted, but can when another admin exists', () => {
    expect(wouldRemoveLastAdmin(db, 'a', 'user')).toBe(true)
    expect(wouldRemoveLastAdmin(db, 'a', 'admin')).toBe(false)
    addUser('b', 'admin')
    expect(wouldRemoveLastAdmin(db, 'a', 'user')).toBe(false)
  })

  it('demoting a non-admin is fine', () => {
    addUser('c')
    expect(wouldRemoveLastAdmin(db, 'c', 'user')).toBe(false)
  })
})
