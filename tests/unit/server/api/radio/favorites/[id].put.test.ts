import { afterEach, describe, expect, vi } from 'vitest'

import { listRadioFavorites } from '~~/server/db/radioFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'
import { station, summary } from '~~/tests/fixtures/radio'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('~~/server/utils/radioApi', async importOriginal => ({
  ...(await importOriginal<typeof import('~~/server/utils/radioApi')>()),
  getRadioStation: lookup,
}))

let userId: string | null
let id: unknown
let save: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  lookup.mockReset().mockResolvedValue(station)
  for (const id of ['alice', 'bob']) addUser(db, id)
  userId = 'alice'
  id = station.id
  stubNitro({ requireUser: requireUserAs(() => userId), useDb: () => db, getRouterParam: () => id })
  save = (await import('~~/server/api/radio/favorites/[id].put')).default as typeof save
})
afterEach(() => vi.unstubAllGlobals())

describe('PUT /api/radio/favorites/:id', () => {
  test('requires a session', async () => {
    userId = null
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(lookup).not.toHaveBeenCalled()
  })
  test('validates IDs before lookup or mutation', async ({ db }) => {
    for (id of [undefined, 'bad', ['id'], '../admin']) await expect(save({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(lookup).not.toHaveBeenCalled()
    expect(listRadioFavorites(db, 'alice')).toEqual([])
  })
  test('saves validated directory data under the normalized ID, without the stream URL', async ({ db }) => {
    id = station.id.toUpperCase()
    expect(await save({} as never)).toEqual({ ...summary, available: true })
    expect(lookup).toHaveBeenCalledWith(station.id)
    expect(listRadioFavorites(db, 'alice')).toEqual([summary])
    expect(listRadioFavorites(db, 'bob')).toEqual([])
  })
  test('rejects an unavailable station without exposing upstream errors', async ({ db }) => {
    lookup.mockRejectedValue(new Error('private upstream details'))
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 503, message: 'This station is unavailable. Try again later.' })
    expect(listRadioFavorites(db, 'alice')).toEqual([])
  })
  test('limits upstream requests per account', async () => {
    for (let i = 0; i < 10; i++) await save({} as never)
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 429 })
    userId = 'bob'
    await expect(save({} as never)).resolves.toMatchObject({ id: station.id })
  })
})
