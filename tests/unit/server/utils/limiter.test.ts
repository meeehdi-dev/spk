import { describe, expect, it, vi } from 'vitest'

import { SOUND_COOLDOWN_MS } from '#shared/utils/sounds'
import { createLimiter } from '~~/server/utils/limiter'

describe('createLimiter', () => {
  it('allows max per window', () => {
    const ok = createLimiter(2, 1000)
    expect([ok('k', 0), ok('k', 1), ok('k', 2), ok('k', 1001)]).toEqual([true, true, false, true])
  })
  it('allows one sound per 3 s per user', () => {
    const allow = createLimiter(1, SOUND_COOLDOWN_MS)
    expect(allow('a', 0)).toBe(true)
    expect(allow('a', 2_999)).toBe(false)
    expect(allow('b', 1_000)).toBe(true)
    expect(allow('a', 3_000)).toBe(true)
  })
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
