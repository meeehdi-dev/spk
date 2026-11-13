import { describe, expect } from 'vitest'

import { listRadioFavorites, removeRadioFavorite, saveRadioFavorite } from '~~/server/db/radioFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { station, summary } from '~~/tests/fixtures/radio'

test.beforeEach(({ db }) => {
  for (const id of ['alice', 'bob']) addUser(db, id)
})

describe('radio favorite persistence', () => {
  test('isolates users, deduplicates saves, and safely repeats removals', ({ db }) => {
    saveRadioFavorite(db, 'alice', station)
    saveRadioFavorite(db, 'alice', station)
    saveRadioFavorite(db, 'bob', station)
    expect(listRadioFavorites(db, 'alice')).toEqual([summary])
    removeRadioFavorite(db, 'alice', station.id)
    removeRadioFavorite(db, 'alice', station.id)
    expect(listRadioFavorites(db, 'alice')).toEqual([])
    expect(listRadioFavorites(db, 'bob')).toHaveLength(1)
  })
  test('bounds saved stations while allowing an existing favorite at the limit', ({ db }) => {
    for (let i = 0; i < 50; i++) expect(saveRadioFavorite(db, 'alice', { ...station, id: String(i) })).toBe(true)
    expect(saveRadioFavorite(db, 'alice', station)).toBe(false)
    expect(saveRadioFavorite(db, 'alice', { ...station, id: '0' })).toBe(true)
    expect(listRadioFavorites(db, 'alice')).toHaveLength(50)
  })
  test('cascades favorites on account deletion', ({ db }) => {
    saveRadioFavorite(db, 'alice', station)
    db.$client.prepare('DELETE FROM users WHERE id = ?').run('alice')
    expect(listRadioFavorites(db, 'alice')).toEqual([])
  })
})
