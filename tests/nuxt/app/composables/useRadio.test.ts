import type { SavedDevice } from '#shared/utils/voice'
import type { SocketFrame } from '~/composables/useSocket'
import type { RadioPlayback } from '~/utils/radio-player'

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import { useRadio, useRadioLive } from '~/composables/useRadio'

const media = vi.hoisted(() => ({ start: vi.fn(async () => {}), stop: vi.fn(), output: vi.fn(), status: (_value: RadioPlayback) => {} }))
vi.mock('~/utils/radio-player', () => ({
  createRadioPlayer: (status: (value: RadioPlayback) => void) => {
    media.status = status
    media.stop.mockImplementation(() => status('idle'))
    return media
  },
}))

const mocks = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    voice: {
      sid: 's',
      setRadioListening: vi.fn(),
      channelId: ref<string | null>(null),
      mute: ref({ deafened: false, muted: false }),
      settings: ref<{ radioVolume: number; outputVolume: number; speaker?: SavedDevice; mediaSpeaker?: SavedDevice }>({ radioVolume: 0.5, outputVolume: 1 }),
      devices: ref({ speakers: [] as Array<{ deviceId: string; label: string }> }),
    },
    connected: ref(true),
    send: vi.fn(() => true),
    receive: (_frame: SocketFrame) => {},
  }
})
mockNuxtImport('useVoice', () => () => mocks.voice)
mockNuxtImport('useSocket', () => () => ({
  connected: mocks.connected,
  send: mocks.send,
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

const session = { metadata: null as unknown, playbackState: 'none', setActionHandler: vi.fn() }
Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
vi.stubGlobal('MediaMetadata', function (this: object, init: object) {
  Object.assign(this, init)
})
const handler = (action: string) => session.setActionHandler.mock.calls.findLast(c => c[0] === action)?.[1] as (() => void) | null

beforeEach(async () => {
  vi.clearAllMocks()
  session.metadata = null
  session.playbackState = 'none'
  const { voice } = mocks
  voice.channelId.value = null
  voice.mute.value = { deafened: false, muted: false }
  voice.settings.value = { radioVolume: 0.5, outputVolume: 1 }
  voice.devices.value = { speakers: [] }
  mocks.connected.value = true
  mocks.send.mockReturnValue(true)
  useRadio().enabled.value = true
  await mountSuspended(defineComponent({ setup: () => (useRadioLive(), () => null) }))
  voice.channelId.value = 'c'
})

describe('radio session lifecycle', () => {
  it('announces listening only during audible playback and clears it on mute, failure and leave', () => {
    const { voice } = mocks
    const listening = () => voice.setRadioListening.mock.lastCall?.[0]
    receive(frame(1))
    expect(listening()).toBe(false)
    media.status('playing')
    expect(listening()).toBe(true)
    voice.mute.value.muted = true
    expect(listening()).toBe(true)
    voice.mute.value.deafened = true
    expect(listening()).toBe(false)
    voice.mute.value.deafened = false
    expect(listening()).toBe(true)
    voice.settings.value.radioVolume = 0
    expect(listening()).toBe(false)
    voice.settings.value.radioVolume = 0.5
    voice.settings.value.outputVolume = 0
    expect(listening()).toBe(false)
    voice.settings.value.outputVolume = 1
    expect(listening()).toBe(true)
    useRadio().mute()
    expect(listening()).toBe(false)
    useRadio().listen()
    media.status('playing')
    expect(listening()).toBe(true)
    media.status('error')
    expect(listening()).toBe(false)
    media.status('blocked')
    expect(listening()).toBe(false)
    media.status('playing')
    voice.channelId.value = null
    expect(listening()).toBe(false)
  })
  it('follows media output changes and unplug/replug independently of voice without restarting', () => {
    const { voice } = mocks
    voice.devices.value.speakers = [
      { deviceId: 'media', label: 'Media' },
      { deviceId: 'voice', label: 'Voice' },
    ]
    voice.settings.value.speaker = { deviceId: 'voice', label: 'Voice' }
    voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    receive(frame(1))
    expect(media.output).toHaveBeenLastCalledWith(0.5, false, 'media')
    voice.devices.value.speakers = [{ deviceId: 'voice', label: 'Voice' }]
    expect(media.output).toHaveBeenLastCalledWith(0.5, false, '')
    voice.devices.value.speakers.push({ deviceId: 'new-media', label: 'Media' })
    expect(media.output).toHaveBeenLastCalledWith(0.5, false, 'new-media')
    voice.settings.value.mediaSpeaker = undefined
    expect(media.output).toHaveBeenLastCalledWith(0.5, false, '')
    expect(media.start).toHaveBeenCalledTimes(1)
    expect(voice.settings.value.speaker.deviceId).toBe('voice')
  })
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
  it('clears local pause when selecting a new station and plays its stream', () => {
    receive(frame(1))
    const radio = useRadio()
    radio.mute()
    radio.select('new-station')
    expect(mocks.send).toHaveBeenLastCalledWith({ type: 'voice:radio:set', sid: 's', stationId: 'new-station' })
    expect(radio.enabled.value).toBe(true)
    receive({ ...frame(2), station: { ...station, id: 'new-station', url: 'https://stream.example.com/two' } })
    expect(media.start).toHaveBeenLastCalledWith('https://stream.example.com/two')
  })
  it('resumes playback when reselecting the same station while paused', () => {
    receive(frame(1))
    const radio = useRadio()
    radio.mute()
    media.start.mockClear()
    radio.select(station.id)
    receive(frame(2))
    expect(radio.enabled.value).toBe(true)
    expect(media.start).toHaveBeenCalledExactlyOnceWith(station.url)
  })
  it('keeps local pause when a station selection cannot be sent', () => {
    receive(frame(1))
    const radio = useRadio()
    radio.mute()
    media.start.mockClear()
    mocks.connected.value = false
    mocks.send.mockReturnValue(false)
    radio.select('new-station')
    expect(radio.enabled.value).toBe(false)
    expect(media.start).not.toHaveBeenCalled()
    expect(radio.commandError.value).toBe('Radio controls are offline. Wait for reconnection.')
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
    mocks.voice.settings.value.radioVolume = 2
    mocks.voice.settings.value.outputVolume = 2
    expect(media.output).toHaveBeenLastCalledWith(4, true, '')
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

describe('media session', () => {
  it('mirrors the station, routes media keys to local mute only and clears without a station', () => {
    receive(frame(1))
    expect(session.metadata).toMatchObject({
      title: 'Station',
      artist: 'spk radio',
      artwork: [{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }],
    })
    expect(session.playbackState).toBe('paused')
    media.status('playing')
    expect(session.playbackState).toBe('playing')
    handler('pause')!()
    expect(useRadio().enabled.value).toBe(false)
    expect(session.playbackState).toBe('paused')
    expect(mocks.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'voice:radio:stop' }))
    handler('play')!()
    expect(useRadio().enabled.value).toBe(true)
    handler('stop')!()
    expect(useRadio().enabled.value).toBe(false)
    receive(frame(2, 'c', 's', null))
    expect(session.metadata).toBeNull()
    expect(session.playbackState).toBe('none')
    expect(handler('play')).toBeNull()
  })
})
