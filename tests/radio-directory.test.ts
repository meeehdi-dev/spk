import type { Hooks, Peer } from 'crossws'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let state: typeof import('../server/utils/radioState')
let presence: typeof import('../server/utils/voicePresence')
let peers: typeof import('../server/utils/peers')
const station = { id: 'station', name: 'Radio', url: 'https://stream.example.com/live', codec: 'MP3', country: 'FR' }
const selected = { channelId: 'c', station: { id: station.id, name: station.name } }
let messages: unknown[]

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  state = await import('../server/utils/radioState')
  presence = await import('../server/utils/voicePresence')
  peers = await import('../server/utils/peers')
  messages = []
  peers.addPeer('observer', { send: (raw: string) => messages.push(JSON.parse(raw)) } as unknown as Peer)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('radio directory server', () => {
  it('broadcasts selection, replacement, and stop to observers outside voice without stream URLs', () => {
    const radio = state.channelRadio('c')
    state.setChannelRadio(radio, station)
    expect(messages).toEqual([{ type: 'radio:update', ...selected }])
    expect(state.radioSnapshot()).toEqual([selected])
    state.setChannelRadio(radio, { ...station, id: 'second', name: 'Second' })
    expect(state.radioSnapshot()).toEqual([{ channelId: 'c', station: { id: 'second', name: 'Second' } }])
    state.setChannelRadio(radio, null)
    expect(messages.at(-1)).toEqual({ type: 'radio:update', channelId: 'c', station: null })
    expect(state.radioSnapshot()).toEqual([])
  })

  it.each(['leave', 'close', 'move', 'delete'])('clears directory state on last session cleanup: %s', reason => {
    const owner = {}
    presence.joinVoice('listener', 'c', 's', owner)
    state.setChannelRadio(state.channelRadio('c'), station)
    if (reason === 'leave') presence.leaveVoice('listener', 's')
    if (reason === 'close') presence.dropVoiceOwner(owner)
    if (reason === 'move') presence.joinVoice('listener', 'other', 's', owner)
    if (reason === 'delete') state.clearChannelRadio('c')
    expect(state.radioSnapshot()).toEqual([])
    expect(messages.at(-1)).toEqual({ type: 'radio:update', channelId: 'c', station: null })
  })

  it('keeps the indicator until the final listener leaves', () => {
    presence.joinVoice('one', 'c', 'a', {})
    presence.joinVoice('two', 'c', 'b', {})
    state.setChannelRadio(state.channelRadio('c'), station)
    presence.leaveVoice('one', 'a')
    expect(state.radioSnapshot()).toEqual([selected])
    expect(messages).toHaveLength(1)
    presence.leaveVoice('two', 'b')
    expect(state.radioSnapshot()).toEqual([])
  })

  it.each([false, true])('sends the current snapshot on socket open, station selected: %s', active => {
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
    return import('../server/routes/_ws').then(async () => {
      await hooks.open!(peer)
      expect(raw.map(value => JSON.parse(value))).toContainEqual({ type: 'radio:snapshot', channels: active ? [selected] : [] })
      await hooks.close!(peer, { code: 1000, reason: '' })
    })
  })
})
