import type { Peer } from 'crossws'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { addPeer } from '~~/server/utils/peers'
import { endUserConnections } from '~~/server/utils/voiceAdmin'
import { joinVoice, sessionOf } from '~~/server/utils/voicePresence'

const fake = () => ({ send: vi.fn(), close: vi.fn() })
const setup = () => {
  vi.stubGlobal('useRuntimeConfig', () => ({ livekit: {}, public: {} }))
  const p1 = fake(),
    p2 = fake()
  addPeer('u-end', p1 as unknown as Peer)
  addPeer('u-end', p2 as unknown as Peer)
  joinVoice('u-end', 'vc', 'sid1', {})
  return [p1, p2]
}
const sent = (p: ReturnType<typeof fake>) => p.send.mock.calls.map(c => JSON.parse(c[0]).type)

afterEach(() => vi.unstubAllGlobals())

describe('endUserConnections', () => {
  it('reset: ends voice, sends voice:disconnect then signed-out, closes every peer with 4001', () => {
    const ps = setup()
    endUserConnections('u-end', 'reset')
    expect(sessionOf('u-end')).toBeNull()
    for (const p of ps) {
      expect(sent(p)).toEqual(['voice:presence', 'voice:disconnect', 'signed-out'])
      expect(p.close).toHaveBeenCalledWith(4001, 'signed out')
    }
  })
  it('ban: still sends banned and closes with 4003', () => {
    const ps = setup()
    endUserConnections('u-end', 'banned')
    expect(sessionOf('u-end')).toBeNull()
    for (const p of ps) {
      expect(sent(p)).toEqual(['voice:presence', 'voice:disconnect', 'banned'])
      expect(p.close).toHaveBeenCalledWith(4003, 'banned')
    }
  })
})
