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
    prepareConnection = vi.fn(async () => {})
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

describe('subscription failures', () => {
  it('reports a subscription failure', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    media.rooms[0]!.emit('TrackSubscriptionFailed', 'TR_bad', {})
    expect(info).toHaveBeenCalledWith('[spk] connection outage', expect.objectContaining({ cause: 'subFailed', track: 'TR_bad' }))
  })
})
