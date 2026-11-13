import { describe, expect, it } from 'vitest'

import { addPeer, presenceSnapshot, removePeer } from '~~/server/utils/peers'

describe('manual status on connect', () => {
  it('a first socket carrying invisible or busy never announces online', () => {
    const p = {} as never
    expect(addPeer('inv', p, 'offline')).toBeNull()
    expect(presenceSnapshot()).not.toHaveProperty('inv')
    expect(addPeer('bz', {} as never, 'busy')).toBe('busy')
    removePeer('inv', p)
  })
})
