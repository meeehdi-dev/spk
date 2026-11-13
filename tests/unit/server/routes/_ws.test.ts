import type { Hooks, Peer } from 'crossws'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const station = { id: 'station', name: 'Radio', url: 'https://stream.example.com/live', codec: 'MP3', country: 'FR' }
const selected = { channelId: 'c', station: { id: station.id, name: station.name } }

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('websocket open', () => {
  it.each([false, true])('sends the current radio snapshot, station selected: %s', async active => {
    const state = await import('~~/server/utils/radioState')
    const peers = await import('~~/server/utils/peers')
    if (active) state.setChannelRadio(state.channelRadio('c'), station)
    let hooks!: Hooks
    vi.stubGlobal('defineWebSocketHandler', (value: Hooks) => {
      hooks = value
    })
    vi.stubGlobal('addPeer', peers.addPeer)
    vi.stubGlobal('broadcast', peers.broadcast)
    vi.stubGlobal('removePeer', peers.removePeer)
    vi.stubGlobal('dropVoiceSocket', vi.fn())
    const raw: string[] = []
    const peer = { context: { userId: 'late' }, send: (value: string) => raw.push(value) } as unknown as Peer
    await import('~~/server/routes/_ws')
    await hooks.open!(peer)
    expect(raw.map(value => JSON.parse(value))).toContainEqual({ type: 'radio:snapshot', channels: active ? [selected] : [] })
    await hooks.close!(peer, { code: 1000, reason: '' })
  })
})
