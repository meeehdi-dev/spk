import type { SocketFrame } from '~/composables/useSocket'

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import { useRadio, useRadioLive } from '~/composables/useRadio'

const media = vi.hoisted(() => ({ start: vi.fn(async () => {}), stop: vi.fn(), output: vi.fn() }))
vi.mock('~/utils/radio-player', () => ({ createRadioPlayer: () => media }))

const mocks = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    voice: {
      sid: 's',
      channelId: ref<string | null>(null),
      mute: ref({ deafened: false, muted: false }),
      settings: ref<{ radioVolume: number; outputVolume: number; speaker?: undefined }>({ radioVolume: 0.5, outputVolume: 1 }),
      devices: ref({ speakers: [] as Array<{ deviceId: string; label: string }> }),
    },
    connected: ref(true),
    receive: (_frame: SocketFrame) => {},
  }
})
mockNuxtImport('useVoice', () => () => mocks.voice)
mockNuxtImport('useSocket', () => () => ({
  connected: mocks.connected,
  send: () => true,
  on: (fn: (frame: SocketFrame) => void) => {
    mocks.receive = fn
  },
}))

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
const receive = (m: SocketFrame) => mocks.receive(m)

beforeEach(async () => {
  vi.clearAllMocks()
  const { voice } = mocks
  voice.channelId.value = null
  voice.mute.value = { deafened: false, muted: false }
  voice.settings.value = { radioVolume: 0.5, outputVolume: 1 }
  voice.devices.value = { speakers: [] }
  mocks.connected.value = true
  useRadio().enabled.value = true
  await mountSuspended(defineComponent({ setup: () => (useRadioLive(), () => null) }))
  voice.channelId.value = 'c'
})

describe('radio session lifecycle', () => {
  it('plays late-join state, ignores older revisions and other sessions, and stops on leave', () => {
    receive(frame(2))
    expect(useRadio().station.value).toEqual(station)
    receive(frame(1, 'c', 's', null))
    receive(frame(3, 'other'))
    receive(frame(4, 'c', 'old-session'))
    expect(useRadio().station.value).toEqual(station)
    expect(media.start).toHaveBeenCalledTimes(1)
    mocks.voice.channelId.value = null
    expect(useRadio().station.value).toBeNull()
    receive(frame(5))
    expect(media.start).toHaveBeenCalledTimes(1)
  })
  it('stops during socket loss and accepts a fresh snapshot after reconnection', () => {
    receive(frame(10))
    mocks.connected.value = false
    expect(useRadio().station.value).toBeNull()
    mocks.connected.value = true
    receive(frame(1)) // the app server may have restarted
    expect(media.start).toHaveBeenCalledTimes(2)
  })
  it('keeps local mute through station changes and resumes the latest stream on Listen', () => {
    receive(frame(1))
    const radio = useRadio()
    radio.mute()
    receive({ ...frame(2), station: { ...station, url: 'https://stream.example.com/two' } })
    expect(media.start).toHaveBeenCalledTimes(1)
    radio.listen()
    expect(media.start).toHaveBeenLastCalledWith('https://stream.example.com/two')
  })
  it('routes deafen and volume changes but does not treat mic mute as radio mute', () => {
    receive(frame(1))
    mocks.voice.mute.value.muted = true
    expect(media.start).toHaveBeenCalledTimes(1)
    expect(useRadio().enabled.value).toBe(true)
    mocks.voice.mute.value.deafened = true
    expect(media.output).toHaveBeenLastCalledWith(0.5, true, '')
    mocks.voice.settings.value.radioVolume = 0.3
    mocks.voice.settings.value.outputVolume = 0.5
    expect(media.output).toHaveBeenLastCalledWith(0.15, true, '')
  })
  it('clears the previous station on move and ignores a late response from the old channel', () => {
    receive(frame(1))
    mocks.voice.channelId.value = 'destination'
    receive(frame(2))
    expect(useRadio().station.value).toBeNull()
    receive(frame(3, 'destination'))
    expect(media.start).toHaveBeenCalledTimes(2)
  })
})
