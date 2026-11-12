import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('../server/utils/radioApi', () => ({ searchRadioStations: lookup }))
let handler: (event: never) => Promise<unknown>
let q: unknown
let signedIn: boolean
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  q = 'jazz'
  signedIn = true
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  vi.stubGlobal('requireUser', async () => {
    if (!signedIn) throw createError({ statusCode: 401 })
    return { id: 'user' }
  })
  vi.stubGlobal('getQuery', () => ({ q }))
  vi.stubGlobal('createError', createError)
  handler = (await import('../server/api/radio/stations.get')).default as typeof handler
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('radio station search endpoint', () => {
  it('requires authentication and validates bounded single-string searches', async () => {
    signedIn = false
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    signedIn = true
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
