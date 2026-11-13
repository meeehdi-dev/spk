import { describe, expect, it } from 'vitest'

import { cleanMime, formatBytes } from '#shared/utils/files'

describe('cleanMime', () => {
  it('lowercases a type/subtype and rejects anything else', () => {
    expect(cleanMime('Image/PNG')).toBe('image/png')
    expect(cleanMime('x')).toBeNull()
  })
})

describe('formatBytes', () => {
  it('formats bytes and megabytes', () => {
    expect(formatBytes(20 * 1024 * 1024)).toMatch(/20\s?MB/)
    expect(formatBytes(300)).toMatch(/300\s?byte|300\s?B/)
  })
})
