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
  navigateTo: vi.fn(),
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
mockNuxtImport('navigateTo', () => mocks.navigateTo)

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

type Frame = Record<string, unknown>
function pub(source: string, trackSid: string, subscribed: boolean) {
  const p = { source, trackSid, isDesired: false, isSubscribed: subscribed, setSubscribed: vi.fn(), track: undefined as unknown }
  p.setSubscribed.mockImplementation((on: boolean) => {
    p.isDesired = on
  })
  return p
}
/** A subscribed mic whose inbound packet counter is `counter.n`. */
function mic(trackSid: string, counter: { n: number }, elements: unknown[] = []) {
  const p = pub('microphone', trackSid, true)
  p.track = {
    attachedElements: elements,
    getRTCStatsReport: async () => new Map([['in', { type: 'inbound-rtp', packetsReceived: counter.n }]]),
    on: vi.fn(),
    off: vi.fn(),
  }
  return p
}

let voice: ReturnType<typeof import('~/composables/useVoice').useVoice>
let receive: (m: Frame) => void
let toast: ReturnType<typeof vi.fn>
const info = () => vi.spyOn(console, 'info').mockImplementation(() => {})
const present = (userId: string, muted = false) =>
  receive({ type: 'voice:presence', userId, channelId: 'channel', muted, deafened: false, speaking: false, cam: false, screen: false, watching: [] })
const join = (userId: string, pubs: ReturnType<typeof pub>[]) => {
  const r = media.rooms.at(-1)!
  const map = new Map(pubs.map(p => [p.trackSid, p]))
  r.remoteParticipants.set(userId, {
    identity: userId,
    isLocal: false,
    trackPublications: map,
    audioTrackPublications: map,
    getTrackPublication: () => undefined,
  })
}
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  media.rooms = []
  mocks.useLocalStorage.mockImplementation((_: string, value: unknown) => ref(value))
  mocks.useVoiceSettings.mockImplementation(() => ref({ noise: 'standard', sensitivity: 50, outputVolume: 1 }))
  toast = vi.fn()
  mocks.useToast.mockImplementation(() => ({ add: toast }))
  mocks.useMe.mockImplementation(() => ({ data: ref({ id: 'local' }) }))
  mocks.useSounds.mockImplementation(() => ({ data: ref([]) }))
  mocks.useWakeLock.mockImplementation(() => ({ request: async () => {}, release: async () => {} }))
  const handlers = new Set<(m: Frame) => void>()
  receive = m => handlers.forEach(fn => fn(m))
  mocks.useSocket.mockImplementation(() => ({
    connected: ref(true),
    lost: ref(false),
    onOpen: vi.fn(),
    on: (fn: (m: Frame) => void) => {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
    send: (m: Frame) => {
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
  const mod = await import('~/composables/useVoice')
  mod.useVoiceLive()
  voice = mod.useVoice()
  await voice.join('channel')
})
afterEach(async () => {
  await voice.leave(false)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('per-member watchdog', () => {
  it('marks a member missing from the room unheard at 4 s, not before, and clears it on recovery', async () => {
    present('ghost')
    await tick(3900)
    expect(voice.unheard.value.size).toBe(0)
    await tick(2100)
    expect([...voice.unheard.value]).toEqual(['ghost'])
    join('ghost', [mic('TR_g', { n: 1 })])
    await tick(4000)
    expect(voice.unheard.value.size).toBe(0)
  })

  it("keeps running when one member's stats read never resolves", async () => {
    const p = mic('TR_hung', { n: 1 })
    ;(p.track as { getRTCStatsReport: () => Promise<never> }).getRTCStatsReport = () => new Promise(() => {})
    join('hung', [p])
    present('hung')
    present('ghost')
    await tick(1500 + 2000) // past the stats timeout and one more tick
    expect(voice.unheard.value.size).toBe(0)
    await tick(4500) // each pass now waits out the 1.5 s timeout; ghost is 4 s old by the third
    expect([...voice.unheard.value]).toEqual(['ghost'])
  })

  it('resubscribes a stalled mic exactly once at 8 s', async () => {
    const spy = info()
    const counter = { n: 10 }
    const p = mic('TR_stall', counter)
    join('peer', [p])
    present('peer')
    await tick(2000) // first reading is fine
    counter.n = 20
    await tick(2000)
    await tick(2000) // stalled from here
    await tick(2000)
    expect(voice.unheard.value.size).toBe(0)
    await tick(2000)
    expect([...voice.unheard.value]).toEqual(['peer'])
    await tick(3900)
    expect(p.setSubscribed).not.toHaveBeenCalled()
    await tick(2000)
    expect(p.setSubscribed.mock.calls).toEqual([[false], [true]])
    await tick(8000)
    expect(p.setSubscribed).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledWith('[spk] connection outage', expect.objectContaining({ cause: 'resubscribed', track: 'TR_stall' }))
  })

  it('resubscribes an unsubscribed mic after 8 s', async () => {
    const p = pub('microphone', 'TR_unsub', false)
    join('peer', [p])
    present('peer')
    await tick(6000)
    expect(p.setSubscribed).not.toHaveBeenCalled()
    await tick(4000)
    expect(p.setSubscribed.mock.calls).toEqual([[false], [true]])
  })

  const rejoins = (spy: ReturnType<typeof info>) => spy.mock.calls.filter(([, d]) => (d as { cause: string }).cause === 'watchdogRejoin').length
  const stalled = (id: string, counter = { n: 1 }) => {
    join(id, [mic(`TR_${id}`, counter)])
    present(id)
    return counter
  }

  it('never rejoins for a member missing from the room', async () => {
    const spy = info()
    present('ghost')
    await tick(40_000)
    expect(rejoins(spy)).toBe(0)
    expect(media.rooms).toHaveLength(1)
  })

  it('does not rejoin while another unmuted member is fine', async () => {
    const spy = info()
    stalled('bad')
    const good = stalled('good')
    for (let i = 0; i < 20; i++) {
      good.n++
      await tick(2000)
    }
    expect(rejoins(spy)).toBe(0)
    expect(media.rooms).toHaveLength(1)
  })

  it('does not rejoin for a lone stalled member in a 1-on-1', async () => {
    const spy = info()
    stalled('solo')
    await tick(40_000)
    expect(rejoins(spy)).toBe(0)
    expect(media.rooms).toHaveLength(1)
  })

  it('rejoins once when every unmuted member in the room is stalled, and the 60 s cooldown holds', async () => {
    const spy = info()
    stalled('a')
    stalled('b')
    present('ghost')
    await tick(20_000) // stalled readings begin at 4 s
    expect(media.rooms).toHaveLength(1)
    await tick(4000)
    expect(rejoins(spy)).toBe(1)
    await tick(1500) // backoff then new room
    expect(media.rooms).toHaveLength(2)
    expect(voice.channelId.value).toBe('channel')
    stalled('c') // the new room is stalled again
    stalled('d')
    await tick(30_000)
    expect(rejoins(spy)).toBe(1)
    expect(media.rooms).toHaveLength(2)
    await tick(40_000)
    expect(rejoins(spy)).toBe(2)
  })

  it('forgets a bad spell from before a reconnect', async () => {
    const spy = info()
    const p = pub('microphone', 'TR_old', false)
    join('peer', [p])
    present('peer')
    await tick(18_000)
    expect(p.setSubscribed).toHaveBeenCalledTimes(2) // resubscribed at 8 s
    p.setSubscribed.mockClear()
    const r = media.rooms.at(-1)!
    r.emit('Reconnecting')
    await tick(1000)
    r.emit('Reconnected')
    expect(voice.unheard.value.size).toBe(0)
    await tick(2000)
    expect(p.setSubscribed).not.toHaveBeenCalled()
    expect(rejoins(spy)).toBe(0)
    expect(voice.unheard.value.size).toBe(0)
  })

  it('treats a muted member as bad only when missing from the room', async () => {
    const p = pub('microphone', 'TR_muted', false)
    join('quiet', [p])
    present('quiet', true)
    await tick(30_000)
    expect(voice.unheard.value.size).toBe(0)
    expect(p.setSubscribed).not.toHaveBeenCalled()
    media.rooms.at(-1)!.remoteParticipants.delete('quiet')
    await tick(6000)
    expect([...voice.unheard.value]).toEqual(['quiet'])
  })

  it('plays a paused element and reports a blocked one', async () => {
    const element = { paused: true, play: vi.fn(async () => {}) }
    join('peer', [mic('TR_el', { n: 1 }, [element])])
    present('peer')
    await tick(2000)
    expect(element.play).toHaveBeenCalled()
    expect(voice.audioBlocked.value).toBe(false)
    element.play.mockRejectedValue(new Error('NotAllowed'))
    await tick(2000)
    expect(voice.audioBlocked.value).toBe(true)
  })
})
