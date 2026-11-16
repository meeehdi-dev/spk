import { describe, expect } from 'vitest'

import { listGifFavorites, removeGifFavorite, saveGifFavorite } from '~~/server/db/gifFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { gif } from '~~/tests/fixtures/gifs'

test.beforeEach(({ db }) => {
  for (const id of ['alice', 'bob']) addUser(db, id)
})

describe('GIF favorite persistence', () => {
  test('isolates users, deduplicates saves, sorts results and safely repeats removals', ({ db }) => {
    saveGifFavorite(db, 'alice', gif)
    saveGifFavorite(db, 'alice', gif)
    saveGifFavorite(db, 'alice', { ...gif, id: 'another', title: 'A cat' })
    saveGifFavorite(db, 'bob', gif)
    expect(listGifFavorites(db, 'alice')).toEqual([{ ...gif, id: 'another', title: 'A cat' }, gif])
    removeGifFavorite(db, 'alice', gif.id)
    removeGifFavorite(db, 'alice', gif.id)
    expect(listGifFavorites(db, 'alice')).toHaveLength(1)
    expect(listGifFavorites(db, 'bob')).toEqual([gif])
  })
  test('limits favorites per account while allowing duplicate saves at the limit', ({ db }) => {
    for (let i = 0; i < 50; i++) expect(saveGifFavorite(db, 'alice', { ...gif, id: String(i) })).toBe(true)
    expect(saveGifFavorite(db, 'alice', gif)).toBe(false)
    expect(saveGifFavorite(db, 'alice', { ...gif, id: '0' })).toBe(true)
    expect(saveGifFavorite(db, 'bob', gif)).toBe(true)
    expect(listGifFavorites(db, 'alice')).toHaveLength(50)
  })
  test('cascades favorites on account deletion', ({ db }) => {
    saveGifFavorite(db, 'alice', gif)
    db.$client.prepare('DELETE FROM users WHERE id = ?').run('alice')
    expect(listGifFavorites(db, 'alice')).toEqual([])
  })
})
