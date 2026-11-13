import { afterEach, describe, expect, vi } from 'vitest'

import { listRadioFavorites, saveRadioFavorite } from '~~/server/db/radioFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'
import { station } from '~~/tests/fixtures/radio'

let userId: string | null
let id: unknown
let remove: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  for (const id of ['alice', 'bob']) {
    addUser(db, id)
    saveRadioFavorite(db, id, station)
  }
  userId = 'alice'
  id = station.id
  stubNitro({ requireUser: requireUserAs(() => userId), useDb: () => db, getRouterParam: () => id })
  remove = (await import('~~/server/api/radio/favorites/[id].delete')).default as typeof remove
})
afterEach(() => vi.unstubAllGlobals())

describe('DELETE /api/radio/favorites/:id', () => {
  test('requires a session', async ({ db }) => {
    userId = null
    await expect(remove({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(listRadioFavorites(db, 'alice')).toHaveLength(1)
  })
  test('validates IDs before mutation', async ({ db }) => {
    for (id of [undefined, 'bad', ['id'], '../admin']) await expect(remove({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(listRadioFavorites(db, 'alice')).toHaveLength(1)
  })
  test("removes only the caller's favorite under the normalized ID, and repeats safely", async ({ db }) => {
    userId = 'bob'
    id = station.id.toUpperCase()
    expect(await remove({} as never)).toEqual({ ok: true })
    expect(await remove({} as never)).toEqual({ ok: true })
    expect(listRadioFavorites(db, 'bob')).toEqual([])
    expect(listRadioFavorites(db, 'alice')).toHaveLength(1)
  })
})
