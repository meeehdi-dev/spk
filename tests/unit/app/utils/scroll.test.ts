import { describe, expect, it } from 'vitest'

import { atBottom, pinAfterScroll, keepPosition, needsOlder } from '~/utils/scroll'

describe('scroll math', () => {
  it('loads older near the top, or when nothing scrolls (page too short)', () => {
    expect(needsOlder(0, true, false)).toBe(true)
    expect(needsOlder(199, true, false)).toBe(true)
    expect(needsOlder(200, true, false)).toBe(false)
    expect(needsOlder(0, false, false)).toBe(false)
    expect(needsOlder(0, true, true)).toBe(false)
  })
  it('keeps the view anchored after a prepend', () => {
    expect(keepPosition(40, 1000, 3000)).toBe(2040)
  })
  it('detects the bottom with slack', () => {
    expect(atBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true)
    expect(atBottom({ scrollHeight: 1000, scrollTop: 598, clientHeight: 400 })).toBe(true)
    expect(atBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false)
  })
  it('keeps the pin when content grows under a stale position, releases on an upward move', () => {
    const grown = { scrollHeight: 1500, scrollTop: 600, clientHeight: 400 }
    expect(pinAfterScroll(true, 600, grown)).toBe(true)
    expect(pinAfterScroll(true, 600, { ...grown, scrollTop: 300 })).toBe(false)
    expect(pinAfterScroll(false, 0, grown)).toBe(false)
    expect(pinAfterScroll(false, 0, { scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true)
  })
})
