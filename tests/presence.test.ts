import { describe, expect, it } from 'vitest'

import { reducePresence } from '../shared/utils/presence'

describe('presence reducer', () => {
  it('offline with no socket, online if any tab is active, idle only when all are idle', () => {
    expect(reducePresence([])).toBe('offline')
    expect(reducePresence([true, false])).toBe('online')
    expect(reducePresence([true, true])).toBe('idle')
    expect(reducePresence([false])).toBe('online')
  })
})
