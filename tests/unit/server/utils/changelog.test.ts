import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const raw = vi.fn()
const cached = vi.fn((fn: unknown) => fn)
let fetchChangelog: (page: number, head: string) => Promise<unknown>
const sha = 'a'.repeat(40)
const commit = { sha, commit: { message: 'feat: changelog\n\nCommit body', committer: { date: '2026-05-20T23:30:00-02:00' } } }

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('$fetch', { raw })
  vi.stubGlobal('defineCachedFunction', cached)
  fetchChangelog = (await import('~~/server/utils/changelog')).fetchChangelog
})
afterEach(() => vi.unstubAllGlobals())

describe('fetchChangelog', () => {
  it('maps subjects and UTC dates, pins the head and follows pagination metadata', async () => {
    raw.mockResolvedValue({ _data: [commit], headers: new Headers({ link: '<https://api.github.com/next>; rel="next"' }) })
    expect(await fetchChangelog(1, 'main')).toEqual({
      commits: [{ sha, message: 'feat: changelog', date: '2026-05-21' }],
      head: sha,
      nextPage: 2,
    })
    expect(raw).toHaveBeenCalledWith(
      'https://api.github.com/repos/meeehdi-dev/spk/commits',
      expect.objectContaining({ query: { sha: 'main', page: 1, per_page: 50 }, retry: 0, timeout: 5000 }),
    )
    expect(cached).toHaveBeenCalledWith(expect.any(Function), { name: 'changelog', maxAge: 300, swr: false })
  })

  it('handles the last page and an empty history', async () => {
    raw.mockResolvedValue({ _data: [], headers: new Headers() })
    expect(await fetchChangelog(2, sha)).toEqual({ commits: [], head: sha, nextPage: null })
    expect(await fetchChangelog(1, 'main')).toEqual({ commits: [], head: null, nextPage: null })
  })

  it('rejects malformed upstream data', async () => {
    for (const data of [
      {},
      [null],
      [{ ...commit, sha: 'not-a-hash' }],
      [{ ...commit, commit: { message: 'test', committer: { date: 'invalid' } } }],
      Array.from({ length: 51 }, () => commit),
    ]) {
      raw.mockResolvedValue({ _data: data, headers: new Headers() })
      await expect(fetchChangelog(1, 'main')).rejects.toThrow('Invalid commit')
    }
  })

  it('propagates rate limits and network errors without caching a success', async () => {
    raw.mockRejectedValue(new Error('Rate limited'))
    await expect(fetchChangelog(1, 'main')).rejects.toThrow('Rate limited')
  })
})
