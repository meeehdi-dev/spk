import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('~~/server/utils/radioApi', () => ({ searchRadioStations: lookup }))

let handler: (event: never) => Promise<unknown>
let q: unknown
let userId: string | null

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  q = 'jazz'
  userId = 'user'
  stubNitro({ requireUser: requireUserAs(() => userId), getQuery: () => ({ q }) })
  handler = (await import('~~/server/api/radio/stations.get')).default as typeof handler
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/radio/stations', () => {
  it('requires authentication and validates bounded single-string searches', async () => {
    userId = null
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    userId = 'user'
    for (const value of [undefined, ['jazz'], 'a', 'x'.repeat(101)]) {
      q = value
      await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 400 })
    }
  })
  it('returns stations and limits directory searches per user', async () => {
    const stations = [{ id: 'station', name: 'Jazz' }]
    lookup.mockResolvedValue(stations)
    for (let i = 0; i < 10; i++) expect(await handler({} as never)).toEqual(stations)
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 429 })
  })
  it('returns an unavailable response without exposing upstream errors', async () => {
    lookup.mockRejectedValue(new Error('internal upstream details'))
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 503, message: 'Radio directory is unavailable. Try again later.' })
  })
})
