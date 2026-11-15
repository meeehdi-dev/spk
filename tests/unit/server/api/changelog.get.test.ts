import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireUserAs, stubNitro } from '~~/tests/fixtures/nitro'

const fetchChangelog = vi.hoisted(() => vi.fn())
vi.mock('~~/server/utils/changelog', () => ({ fetchChangelog }))

let handler: (event: never) => Promise<unknown>
let query: Record<string, unknown>
let userId: string | null
const head = 'a'.repeat(40)

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  query = {}
  userId = 'user'
  stubNitro({ requireUser: requireUserAs(() => userId), getQuery: () => query })
  handler = (await import('~~/server/api/changelog.get')).default as typeof handler
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/changelog', () => {
  it('requires authentication before fetching commits', async () => {
    userId = null
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(fetchChangelog).not.toHaveBeenCalled()
  })

  it('validates pagination and requires a pinned head after page one', async () => {
    for (const invalid of [
      { page: '0' },
      { page: '-1' },
      { page: ['1'] },
      { page: '1.5' },
      { page: '9007199254740992' },
      { page: '2' },
      { head: '../main' },
      { head: [head] },
    ]) {
      query = invalid
      await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(fetchChangelog).not.toHaveBeenCalled()
  })

  it('fetches main initially and uses the pinned head for later pages', async () => {
    const result = { commits: [], head, nextPage: 2 }
    fetchChangelog.mockResolvedValue(result)
    expect(await handler({} as never)).toEqual(result)
    expect(fetchChangelog).toHaveBeenLastCalledWith(1, 'main')
    query = { page: '2', head }
    await handler({} as never)
    expect(fetchChangelog).toHaveBeenLastCalledWith(2, head)
  })

  it('does not expose upstream failures', async () => {
    fetchChangelog.mockRejectedValue(new Error('private upstream detail'))
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 503, message: 'Changelog is unavailable. Try again later.' })
  })
})
