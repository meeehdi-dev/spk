import { describe, expect, it } from 'vitest'

import { canPin } from '#shared/utils/pins'

describe('canPin', () => {
  it('lets anyone pin in DMs and only admins in text channels', () => {
    expect(canPin('dm', 'user')).toBe(true)
    expect(canPin('text', 'user')).toBe(false)
    expect(canPin('text', 'admin')).toBe(true)
    expect(canPin('voice', 'admin')).toBe(false)
    expect(canPin(undefined, 'admin')).toBe(false)
  })
})
