import type { Db } from '../server/db/client'

import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDb } from '../server/db/client'
import { listRadioFavorites, removeRadioFavorite, saveRadioFavorite } from '../server/db/radioFavorites'
import { user } from '../server/db/schema'

const { lookup, summaries } = vi.hoisted(() => ({ lookup: vi.fn(), summaries: vi.fn() }))
vi.mock('../server/utils/radioApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/utils/radioApi')>()),
  getRadioStation: lookup,
  getRadioStationSummaries: summaries,
}))
const station = { id: '12345678-1234-1234-1234-123456789abc', name: 'Jazz', country: 'FR', codec: 'MP3', url: 'https://radio.example.com/live' }
let db: Db
let userId: string | null
let id: unknown
let list: (event: never) => Promise<unknown>
let save: typeof list
let remove: typeof list
beforeEach(async () => {
  vi.resetModules()
  lookup.mockReset().mockResolvedValue(station)
  summaries
    .mockReset()
    .mockImplementation(async (ids: string[]) =>
      ids.includes(station.id) ? [{ id: station.id, name: station.name, country: station.country, codec: station.codec }] : [],
    )
  db = createDb(':memory:')
  db.insert(user)
    .values(['alice', 'bob'].map(id => ({ id, name: id, email: `${id}@example.com` })))
    .run()
  userId = 'alice'
  id = station.id
  vi.stubGlobal('defineEventHandler', (fn: typeof list) => fn)
  vi.stubGlobal('requireUser', async () => {
    if (!userId) throw createError({ statusCode: 401 })
    return { id: userId }
  })
  vi.stubGlobal('useDb', () => db)
  vi.stubGlobal('getRouterParam', () => id)
  vi.stubGlobal('createError', createError)
  list = (await import('../server/api/radio/favorites/index.get')).default as typeof list
  save = (await import('../server/api/radio/favorites/[id].put')).default as typeof list
  remove = (await import('../server/api/radio/favorites/[id].delete')).default as typeof list
})
afterEach(() => {
  db.$client.close()
  vi.unstubAllGlobals()
})

describe('radio favorite persistence', () => {
  it('isolates users, deduplicates saves, and safely repeats removals', () => {
    saveRadioFavorite(db, 'alice', station)
    saveRadioFavorite(db, 'alice', station)
    saveRadioFavorite(db, 'bob', station)
    expect(listRadioFavorites(db, 'alice')).toEqual([{ id: station.id, name: 'Jazz', country: 'FR', codec: 'MP3' }])
    removeRadioFavorite(db, 'alice', station.id)
    removeRadioFavorite(db, 'alice', station.id)
    expect(listRadioFavorites(db, 'alice')).toEqual([])
    expect(listRadioFavorites(db, 'bob')).toHaveLength(1)
  })
  it('bounds saved stations while allowing an existing favorite at the limit', () => {
    for (let i = 0; i < 50; i++) expect(saveRadioFavorite(db, 'alice', { ...station, id: String(i) })).toBe(true)
    expect(saveRadioFavorite(db, 'alice', station)).toBe(false)
    expect(saveRadioFavorite(db, 'alice', { ...station, id: '0' })).toBe(true)
    expect(listRadioFavorites(db, 'alice')).toHaveLength(50)
  })
  it('cascades favorites on account deletion', () => {
    saveRadioFavorite(db, 'alice', station)
    db.$client.prepare('DELETE FROM users WHERE id = ?').run('alice')
    expect(listRadioFavorites(db, 'alice')).toEqual([])
  })
})

describe('radio favorites API', () => {
  it('requires a session for every operation', async () => {
    userId = null
    for (const handler of [list, save, remove]) await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(lookup).not.toHaveBeenCalled()
  })
  it('validates IDs before lookup or mutation', async () => {
    for (id of [undefined, 'bad', ['id'], '../admin']) {
      for (const handler of [save, remove]) await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(lookup).not.toHaveBeenCalled()
    expect(listRadioFavorites(db, 'alice')).toEqual([])
  })
  it('uses validated directory data, normalizes IDs, and persists across requests', async () => {
    id = station.id.toUpperCase()
    await save({} as never)
    expect(lookup).toHaveBeenCalledWith(station.id)
    expect(await list({} as never)).toEqual([{ id: station.id, name: 'Jazz', country: 'FR', codec: 'MP3', available: true }])
    userId = 'bob'
    expect(await list({} as never)).toEqual([])
    await remove({} as never)
    userId = 'alice'
    expect(listRadioFavorites(db, userId)).toHaveLength(1)
    await remove({} as never)
    await remove({} as never)
    expect(await list({} as never)).toEqual([])
  })
  it('keeps unavailable favorites removable without exposing upstream errors', async () => {
    await save({} as never)
    lookup.mockRejectedValue(new Error('private upstream details'))
    summaries.mockResolvedValue([])
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 503, message: 'This station is unavailable. Try again later.' })
    expect(await list({} as never)).toEqual([{ id: station.id, name: 'Jazz', country: 'FR', codec: 'MP3', available: false }])
    await remove({} as never)
    expect(listRadioFavorites(db, 'alice')).toEqual([])
  })
  it('returns saved favorites during a directory outage and still allows removal', async () => {
    await save({} as never)
    summaries.mockRejectedValue(new Error('internal details'))
    expect(await list({} as never)).toEqual([{ id: station.id, name: 'Jazz', country: 'FR', codec: 'MP3', available: null }])
    userId = 'bob'
    expect(await list({} as never)).toEqual([])
    userId = 'alice'
    await remove({} as never)
    expect(listRadioFavorites(db, 'alice')).toEqual([])
  })
  it('limits upstream requests per account', async () => {
    for (let i = 0; i < 10; i++) await save({} as never)
    await expect(save({} as never)).rejects.toMatchObject({ statusCode: 429 })
    for (let i = 0; i < 10; i++) await list({} as never)
    await expect(list({} as never)).rejects.toMatchObject({ statusCode: 429 })
    userId = 'bob'
    await expect(save({} as never)).resolves.toMatchObject({ id: station.id })
  })
})
