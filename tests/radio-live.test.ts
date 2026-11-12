import type { Ref } from 'vue'

import type { SocketFrame } from '../app/composables/useSocket'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref, shallowRef, watch } from 'vue'

const media = vi.hoisted(() => ({ start: vi.fn(async () => {}), stop: vi.fn(), output: vi.fn() }))
vi.mock('~/utils/radio-player', () => ({ createRadioPlayer: () => media }))
let live: typeof import('../app/composables/useRadio')
let voice: {
  sid: string
  channelId: Ref<string | null>
  mute: Ref<{ deafened: boolean; muted: boolean }>
  settings: Ref<{ radioVolume: number; outputVolume: number; speaker?: undefined }>
  devices: Ref<{ speakers: Array<{ deviceId: string; label: string }> }>
}
let connected: Ref<boolean>
let receive: (frame: SocketFrame) => void
let scope: ReturnType<typeof effectScope>
const station = { id: 'station', name: 'Station', url: 'https://stream.example.com/live', country: 'FR', codec: 'MP3' }
const frame = (
  revision: number,
  channelId = 'c',
  sid = 's',
  current: typeof station | null = station,
): Extract<SocketFrame, { type: 'voice:radio:state' }> => ({
  type: 'voice:radio:state',
  sid,
  channelId,
  revision,
  station: current,
})

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  voice = {
    sid: 's',
    channelId: ref(null),
    mute: ref({ deafened: false, muted: false }),
    settings: ref({ radioVolume: 0.5, outputVolume: 1 }),
    devices: ref({ speakers: [] }),
  }
  connected = ref(true)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onScopeDispose', (await import('vue')).onScopeDispose)
  vi.stubGlobal('onMounted', () => {})
  vi.stubGlobal('useVoice', () => voice)
  vi.stubGlobal('useSocket', () => ({
    connected,
    send: vi.fn(() => true),
    on: (fn: typeof receive) => {
      receive = fn
    },
  }))
  live = await import('../app/composables/useRadio')
  scope = effectScope()
  scope.run(() => live.useRadioLive())
  voice.channelId.value = 'c'
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('radio session lifecycle', () => {
  it('plays late-join state, ignores older revisions and other sessions, and stops on leave', () => {
    receive(frame(2))
    expect(live.useRadio().station.value).toEqual(station)
    receive(frame(1, 'c', 's', null))
    receive(frame(3, 'other'))
    receive(frame(4, 'c', 'old-session'))
    expect(live.useRadio().station.value).toEqual(station)
    expect(media.start).toHaveBeenCalledTimes(1)
    voice.channelId.value = null
    expect(live.useRadio().station.value).toBeNull()
    receive(frame(5))
    expect(media.start).toHaveBeenCalledTimes(1)
  })
  it('stops during socket loss and accepts a fresh snapshot after reconnection', () => {
    receive(frame(10))
    connected.value = false
    expect(live.useRadio().station.value).toBeNull()
    connected.value = true
    receive(frame(1)) // the app server may have restarted
    expect(media.start).toHaveBeenCalledTimes(2)
  })
  it('keeps local mute through station changes and resumes the latest stream on Listen', () => {
    receive(frame(1))
    const radio = live.useRadio()
    radio.mute()
    receive({ ...frame(2), station: { ...station, url: 'https://stream.example.com/two' } })
    expect(media.start).toHaveBeenCalledTimes(1)
    radio.listen()
    expect(media.start).toHaveBeenLastCalledWith('https://stream.example.com/two')
  })
  it('routes deafen and volume changes but does not treat mic mute as radio mute', () => {
    receive(frame(1))
    voice.mute.value.muted = true
    expect(media.start).toHaveBeenCalledTimes(1)
    expect(live.useRadio().enabled.value).toBe(true)
    voice.mute.value.deafened = true
    expect(media.output).toHaveBeenLastCalledWith(0.5, true, '')
    voice.settings.value.radioVolume = 0.3
    voice.settings.value.outputVolume = 0.5
    expect(media.output).toHaveBeenLastCalledWith(0.15, true, '')
  })
  it('clears the previous station on move and ignores a late response from the old channel', () => {
    receive(frame(1))
    voice.channelId.value = 'destination'
    receive(frame(2))
    expect(live.useRadio().station.value).toBeNull()
    receive(frame(3, 'destination'))
    expect(media.start).toHaveBeenCalledTimes(2)
  })
})
