import { afterEach, describe, expect, vi } from 'vitest'

import { saveRadioFavorite } from '~~/server/db/radioFavorites'
import { addUser, test } from '~~/tests/fixtures/db'
import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'
import { station, summary } from '~~/tests/fixtures/radio'

const summaries = vi.hoisted(() => vi.fn())
vi.mock('~~/server/utils/radioApi', () => ({ getRadioStationSummaries: summaries }))

let userId: string | null
let list: (event: never) => Promise<unknown>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  summaries.mockReset().mockImplementation(async (ids: string[]) => (ids.includes(station.id) ? [summary] : []))
  for (const id of ['alice', 'bob']) addUser(db, id)
  userId = 'alice'
  stubNitro({ requireUser: requireUserAs(() => userId), useDb: () => db })
  list = (await import('~~/server/api/radio/favorites/index.get')).default as typeof list
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/radio/favorites', () => {
  test('requires a session', async () => {
    userId = null
    await expect(list({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(summaries).not.toHaveBeenCalled()
  })
  test("lists only the caller's favorites, marked available by the directory", async ({ db }) => {
    saveRadioFavorite(db, 'alice', station)
    expect(await list({} as never)).toEqual([{ ...summary, available: true }])
    userId = 'bob'
    expect(await list({} as never)).toEqual([])
  })
  test('marks a favorite unavailable when the directory no longer lists it', async ({ db }) => {
    saveRadioFavorite(db, 'alice', station)
    summaries.mockResolvedValue([])
    expect(await list({} as never)).toEqual([{ ...summary, available: false }])
  })
  test('returns saved favorites during a directory outage', async ({ db }) => {
    saveRadioFavorite(db, 'alice', station)
    summaries.mockRejectedValue(new Error('internal details'))
    expect(await list({} as never)).toEqual([{ ...summary, available: null }])
    userId = 'bob'
    expect(await list({} as never)).toEqual([])
  })
  test('limits upstream requests per account', async () => {
    for (let i = 0; i < 10; i++) await list({} as never)
    await expect(list({} as never)).rejects.toMatchObject({ statusCode: 429 })
    userId = 'bob'
    await expect(list({} as never)).resolves.toEqual([])
  })
})
