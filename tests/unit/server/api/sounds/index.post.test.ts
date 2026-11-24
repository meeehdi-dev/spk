import { afterEach, describe, expect, vi } from 'vitest'

import { addUser, test } from '~~/tests/fixtures/db'
import { stubNitro } from '~~/tests/fixtures/nitro'

const id = '11111111-1111-4111-8111-111111111111'
const broadcast = vi.fn()
let body: unknown
let create: (event: never) => Promise<{ id: string }>

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  broadcast.mockReset()
  addUser(db, 'a')
  body = { id, name: 'Bell', icon: 'bell', durationMs: 1000, size: 100 }
  stubNitro({
    requireAdmin: async () => ({ id: 'a' }),
    useDb: () => db,
    useR2: () => ({}),
    r2Size: async () => 100,
    readBody: async () => body,
    broadcast,
    asHttp: (await import('~~/server/utils/http')).asHttp,
  })
  create = (await import('~~/server/api/sounds/index.post')).default as typeof create
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/sounds', () => {
  test('broadcasts sound:new after saving', async () => {
    await expect(create({} as never)).resolves.toMatchObject({ id })
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({ type: 'sound:new', id })
  })
  test('does not broadcast when the save fails', async () => {
    body = { id, name: '', icon: 'bell', durationMs: 1000, size: 100 }
    await expect(create({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(broadcast).not.toHaveBeenCalled()
  })
})
