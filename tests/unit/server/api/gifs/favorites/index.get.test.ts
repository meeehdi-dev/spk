import { afterEach, expect, vi } from 'vitest'

import { saveGifFavorite } from '~~/server/db/gifFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { gif } from '~~/tests/fixtures/gifs'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

let userId: string | null
let list: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  for (const id of ['alice', 'bob']) addUser(db, id)
  saveGifFavorite(db, 'alice', gif)
  userId = 'alice'
  stubNitro({ requireUser: requireUserAs(() => userId), useDb: () => db })
  list = (await import('~~/server/api/gifs/favorites/index.get')).default as typeof list
})
afterEach(() => vi.unstubAllGlobals())

test('requires authentication', async () => {
  userId = null
  await expect(list({} as never)).rejects.toMatchObject({ statusCode: 401 })
})
test('lists persisted metadata only for the current account, with no upstream dependencies', async () => {
  expect(await list({} as never)).toEqual([gif])
  userId = 'bob'
  expect(await list({} as never)).toEqual([])
})
