import { afterEach, expect, vi } from 'vitest'

import { listGifFavorites, saveGifFavorite } from '~~/server/db/gifFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { gif } from '~~/tests/fixtures/gifs'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

let userId: string | null
let id: unknown
let remove: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  for (const id of ['alice', 'bob']) {
    addUser(db, id)
    saveGifFavorite(db, id, gif)
  }
  userId = 'alice'
  id = gif.id
  stubNitro({ requireUser: requireUserAs(() => userId), useDb: () => db, getRouterParam: () => id })
  remove = (await import('~~/server/api/gifs/favorites/[id].delete')).default as typeof remove
})
afterEach(() => vi.unstubAllGlobals())

test('requires authentication and validates the identifier', async () => {
  userId = null
  await expect(remove({} as never)).rejects.toMatchObject({ statusCode: 401 })
  userId = 'alice'
  id = '../bad'
  await expect(remove({} as never)).rejects.toMatchObject({ statusCode: 400 })
})
test('deletes only the current account favorite, idempotently and without upstream configuration', async ({ db }) => {
  expect(await remove({} as never)).toEqual({ ok: true })
  expect(await remove({} as never)).toEqual({ ok: true })
  expect(listGifFavorites(db, 'alice')).toEqual([])
  expect(listGifFavorites(db, 'bob')).toEqual([gif])
})
test('rate limits deletes per account', async () => {
  for (let i = 0; i < 30; i++) await remove({} as never)
  await expect(remove({} as never)).rejects.toMatchObject({ statusCode: 429 })
  userId = 'bob'
  await expect(remove({} as never)).resolves.toEqual({ ok: true })
})
