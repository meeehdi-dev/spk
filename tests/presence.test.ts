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

describe('manual status', () => {
  it('offline/busy/away override the sockets; no socket is always offline', () => {
    expect(reducePresence([false], 'offline')).toBe('offline')
    expect(reducePresence([false], 'busy')).toBe('busy')
    expect(reducePresence([false], 'away')).toBe('idle')
    expect(reducePresence([true], 'online')).toBe('idle')
    expect(reducePresence([false], 'online')).toBe('online')
    expect(reducePresence([], 'busy')).toBe('offline')
  })
})

describe('manual status on connect', () => {
  it('a first socket carrying invisible or busy never announces online', async () => {
    const { addPeer, presenceSnapshot, removePeer } = await import('../server/utils/peers')
    const p = {} as never
    expect(addPeer('inv', p, 'offline')).toBeNull()
    expect(presenceSnapshot()).not.toHaveProperty('inv')
    expect(addPeer('bz', {} as never, 'busy')).toBe('busy')
    removePeer('inv', p)
  })
})
