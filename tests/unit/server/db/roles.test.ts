import { describe, expect, it } from 'vitest'

import { isAdminRole, wouldRemoveLastAdmin } from '~~/server/db/roles'
import { addUser, test } from '~~/tests/fixtures/db'

describe('isAdminRole', () => {
  it('only the admin role passes (routes call requireAdmin → isAdminRole)', () => {
    expect(isAdminRole('admin')).toBe(true)
    for (const r of ['user', '', null, undefined, 'Admin']) expect(isAdminRole(r)).toBe(false)
  })
})

describe('wouldRemoveLastAdmin', () => {
  test.beforeEach(({ db }) => addUser(db, 'a', { role: 'admin' }))

  test('the last admin cannot be demoted, but can when another admin exists', ({ db }) => {
    expect(wouldRemoveLastAdmin(db, 'a', 'user')).toBe(true)
    expect(wouldRemoveLastAdmin(db, 'a', 'admin')).toBe(false)
    addUser(db, 'b', { role: 'admin' })
    expect(wouldRemoveLastAdmin(db, 'a', 'user')).toBe(false)
  })

  test('demoting a non-admin is fine', ({ db }) => {
    addUser(db, 'c')
    expect(wouldRemoveLastAdmin(db, 'c', 'user')).toBe(false)
  })
})
