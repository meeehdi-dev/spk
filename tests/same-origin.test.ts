import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSameOrigin } from '../server/utils/sameOrigin'
import { createLimiter } from '../server/utils/limiter'

describe('isSameOrigin', () => {
  afterEach(() => { delete process.env.BETTER_AUTH_URL })
  it('allows the app origin and a missing Origin, rejects others', () => {
    process.env.BETTER_AUTH_URL = 'https://spk.example.com/'
    expect(isSameOrigin('https://spk.example.com')).toBe(true)
    expect(isSameOrigin(undefined)).toBe(true)
    expect(isSameOrigin(null)).toBe(true)
    expect(isSameOrigin('https://evil.example.com')).toBeFalsy()
    expect(isSameOrigin('https://spk.example.com.evil.com')).toBeFalsy()
  })
  // shortcut: import.meta.dev is false under vitest, so the dev-localhost allowance isn't covered; only that production rejects localhost.
  it('rejects a localhost origin when the app is elsewhere (non-dev)', () => {
    process.env.BETTER_AUTH_URL = 'https://spk.example.com'
    expect(isSameOrigin('http://localhost:3000')).toBeFalsy()
  })
})

describe('limiter', () => {
  it('deletes a key once its window is empty', () => {
    const del = vi.spyOn(Map.prototype, 'delete')
    const hit = createLimiter(1, 1000)
    expect(hit('a', 0)).toBe(true)
    expect(hit('a', 10)).toBeFalsy()
    expect(del).not.toHaveBeenCalled()
    expect(hit('b', 2000)).toBe(true)
    expect(del).toHaveBeenCalledWith('a')
    del.mockRestore()
  })
})
