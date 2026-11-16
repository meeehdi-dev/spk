import { afterEach, describe, expect, vi } from 'vitest'

import { listGifFavorites, saveGifFavorite } from '~~/server/db/gifFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { gif } from '~~/tests/fixtures/gifs'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

let userId: string | null
let id: unknown
let body: unknown
let save: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  for (const id of ['alice', 'bob']) addUser(db, id)
  userId = 'alice'
  id = gif.id
  body = gif
  stubNitro({ requireUser: requireUserAs(() => userId), useDb: () => db, getRouterParam: () => id, readBody: async () => body })
  save = (await import('~~/server/api/gifs/favorites/[id].put')).default as typeof save
})
afterEach(() => vi.unstubAllGlobals())

describe('PUT /api/gifs/favorites/:id', () => {
  test('requires a session', async () => {
    userId = null
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 401 })
  })
  test('validates IDs and metadata before mutation', async ({ db }) => {
    for (id of [undefined, '../admin', ['id'], 'a'.repeat(129)]) await expect(save({} as never)).rejects.toMatchObject({ statusCode: 400 })
    id = gif.id
    body = { ...gif, url: 'http://example.com/a.gif' }
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(listGifFavorites(db, 'alice')).toEqual([])
  })
  test('saves only validated metadata for the current account without upstream configuration', async ({ db }) => {
    body = { ...gif, id: 'untrusted-body-id', userId: 'bob' }
    expect(await save({} as never)).toEqual(gif)
    expect(listGifFavorites(db, 'alice')).toEqual([gif])
    expect(listGifFavorites(db, 'bob')).toEqual([])
  })
  test('rejects the 51st favorite but permits an existing one', async ({ db }) => {
    for (let i = 0; i < 50; i++) saveGifFavorite(db, 'alice', { ...gif, id: String(i) })
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 409 })
    id = '0'
    await expect(save({} as never)).resolves.toMatchObject({ id: '0' })
  })
  test('rate limits writes per account', async () => {
    for (let i = 0; i < 30; i++) await save({} as never)
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 429 })
    userId = 'bob'
    await expect(save({} as never)).resolves.toEqual(gif)
  })
})
