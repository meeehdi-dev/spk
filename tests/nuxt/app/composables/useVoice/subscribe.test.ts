import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mocks = vi.hoisted(() => ({
  useLocalStorage: vi.fn(),
  useVoiceSettings: vi.fn(),
  useToast: vi.fn(),
  useMe: vi.fn(),
  useSounds: vi.fn(),
  playVoiceSound: vi.fn(),
  onMounted: vi.fn(),
  useEventListener: vi.fn(),
  useWakeLock: vi.fn(),
  useSocket: vi.fn(),
}))
mockNuxtImport('useLocalStorage', () => mocks.useLocalStorage)
mockNuxtImport('useVoiceSettings', () => mocks.useVoiceSettings)
mockNuxtImport('useToast', () => mocks.useToast)
mockNuxtImport('useMe', () => mocks.useMe)
mockNuxtImport('useSounds', () => mocks.useSounds)
mockNuxtImport('playVoiceSound', () => mocks.playVoiceSound)
mockNuxtImport('onMounted', () => mocks.onMounted)
mockNuxtImport('useEventListener', () => mocks.useEventListener)
mockNuxtImport('useWakeLock', () => mocks.useWakeLock)
mockNuxtImport('useSocket', () => mocks.useSocket)

const { media, MockRoom } = vi.hoisted(() => {
  class MockRoom {
    events = new Map<string, ((...args: unknown[]) => void)[]>()
    remoteParticipants = new Map()
    canPlaybackAudio = true
    state = 'connected'
    localParticipant = {
      identity: 'local',
      isLocal: true,
      audioTrackPublications: new Map(),
      trackPublications: new Map(),
      getTrackPublication: () => undefined,
      createTracks: vi.fn(async () => [{ stopOnMute: false, setProcessor: vi.fn(async () => {}), mute: vi.fn(), unmute: vi.fn(), stop: vi.fn() }]),
      publishTrack: vi.fn(async () => {}),
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.events.set(event, [...(this.events.get(event) ?? []), fn])
      return this
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.events.get(event) ?? []) fn(...args)
    }
    connect = vi.fn(async () => {})
    startAudio = vi.fn(async () => {})
    disconnect = vi.fn(async () => {})
    constructor() {
      media.rooms.push(this)
    }
  }
  const media = { rooms: [] as MockRoom[] }
  return { media, MockRoom }
})
vi.mock('~/utils/voice-processor', () => ({
  MicProcessor: class {
    resume = vi.fn(async () => {})
    destroy = vi.fn(async () => {})
  },
}))
vi.mock('livekit-client', () => ({
  Track: { Kind: { Audio: 'audio' } },
  RoomEvent: Object.fromEntries(
    [
      'Disconnected',
      'SignalReconnecting',
      'Reconnecting',
      'Reconnected',
      'AudioPlaybackStatusChanged',
      'ParticipantConnected',
      'ParticipantDisconnected',
      'TrackPublished',
      'TrackUnpublished',
      'TrackSubscribed',
      'TrackUnsubscribed',
      'TrackSubscriptionFailed',
      'TrackMuted',
      'TrackUnmuted',
      'LocalTrackPublished',
      'LocalTrackUnpublished',
      'ActiveSpeakersChanged',
    ].map(name => [name, name]),
  ),
  Room: MockRoom,
  DisconnectReason: {},
}))

function pub(source: string, trackSid: string, subscribed: boolean) {
  const p = { source, trackSid, isDesired: false, isSubscribed: subscribed, setSubscribed: vi.fn() }
  p.setSubscribed.mockImplementation((on: boolean) => {
    p.isDesired = on
  })
  return p
}
const heal = () => document.dispatchEvent(new Event('visibilitychange'))

let voice: ReturnType<typeof import('~/composables/useVoice').useVoice>
beforeEach(async () => {
  vi.resetModules()
  media.rooms = []
  mocks.useLocalStorage.mockImplementation((_: string, value: unknown) => ref(value))
  mocks.useVoiceSettings.mockImplementation(() => ref({ noise: 'standard', sensitivity: 50, outputVolume: 1 }))
  mocks.useToast.mockImplementation(() => ({ add: vi.fn() }))
  mocks.useMe.mockImplementation(() => ({ data: ref({ id: 'local' }) }))
  mocks.useSounds.mockImplementation(() => ({ data: ref([]) }))
  mocks.useWakeLock.mockImplementation(() => ({ request: async () => {}, release: async () => {} }))
  const handlers = new Set<(m: Record<string, unknown>) => void>()
  mocks.useSocket.mockImplementation(() => ({
    connected: ref(true),
    lost: ref(false),
    onOpen: vi.fn(),
    on: (fn: (m: Record<string, unknown>) => void) => {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
    send: (m: Record<string, unknown>) => {
      if (m.type === 'voice:join') for (const fn of handlers) fn({ ...m, type: 'voice:joined' })
      return true
    },
  }))
  vi.stubGlobal(
    '$fetch',
    vi.fn(async () => ({ token: 'token', url: 'url' })),
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }), enumerateDevices: async () => [] },
  })
  voice = (await import('~/composables/useVoice')).useVoice()
  await voice.join('channel')
})
afterEach(async () => {
  await voice.leave(false)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mic subscription healing', () => {
  const peer = (...pubs: ReturnType<typeof pub>[]) => {
    const r = media.rooms[0]!
    const map = new Map(pubs.map(p => [p.trackSid, p]))
    r.remoteParticipants.set('peer', {
      identity: 'peer',
      isLocal: false,
      trackPublications: map,
      audioTrackPublications: map,
      getTrackPublication: () => undefined,
    })
    r.emit('ParticipantConnected')
    return r
  }

  it('resubscribes a mic stuck for 10 s once, leaves healthy and unwatched pubs alone', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const stuck = pub('microphone', 'TR_stuck', false)
    const healthy = pub('microphone', 'TR_ok', true)
    const video = pub('camera', 'TR_video', false)
    peer(stuck, healthy, video)
    stuck.setSubscribed.mockClear()
    healthy.setSubscribed.mockClear()
    heal()
    now += 9_999
    heal()
    expect(stuck.setSubscribed).not.toHaveBeenCalled()
    now += 1
    heal()
    expect(stuck.setSubscribed.mock.calls).toEqual([[false], [true]])
    now += 1
    heal()
    expect(stuck.setSubscribed).toHaveBeenCalledTimes(2)
    expect(healthy.setSubscribed).not.toHaveBeenCalled()
    expect(video.setSubscribed).not.toHaveBeenCalledWith(true)
    expect(info).toHaveBeenCalledWith('[spk] connection outage', expect.objectContaining({ cause: 'resubscribed', track: 'TR_stuck' }))
  })

  it('reports a subscription failure', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    media.rooms[0]!.emit('TrackSubscriptionFailed', 'TR_bad', {})
    expect(info).toHaveBeenCalledWith('[spk] connection outage', expect.objectContaining({ cause: 'subFailed', track: 'TR_bad' }))
  })
})
