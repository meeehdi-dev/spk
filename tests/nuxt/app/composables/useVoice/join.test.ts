import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { cameraConstraints } from '#shared/utils/voice'
import { createDb } from '~~/server/db/client'
import { channels } from '~~/server/db/schema'
import { handleVoiceFrame, dropVoiceSocket } from '~~/server/utils/voice'
import * as sessions from '~~/server/utils/voicePresence'

const mocks = vi.hoisted(() => ({
  useLocalStorage: vi.fn(),
  useVoiceSettings: vi.fn(),
  useToast: vi.fn(),
  useMe: vi.fn(),
  useSounds: vi.fn(),
  playVoiceSound: vi.fn(),
  navigateTo: vi.fn(),
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
mockNuxtImport('navigateTo', () => mocks.navigateTo)
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
    mic = { stopOnMute: false, setProcessor: vi.fn(async () => {}), mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}), stop: vi.fn() }
    cameraPublished = false
    camera = { isMuted: false, restartTrack: vi.fn(async (_options: unknown) => {}) }
    cameraPublication = {
      videoTrack: this.camera,
      track: this.camera,
      get isMuted() {
        return this.videoTrack.isMuted
      },
    }
    engine = { client: { rtt: 42 } }
    localParticipant = {
      audioTrackPublications: new Map(),
      connectionQuality: 'excellent',
      identity: 'local',
      isLocal: true,
      getTrackPublication: (source: string) => (source === 'camera' && this.cameraPublished ? this.cameraPublication : undefined),
      setCameraEnabled: vi.fn(async (on: boolean, _options?: unknown) => {
        this.cameraPublished = true
        this.camera.isMuted = !on
        return this.cameraPublication
      }),
      createTracks: vi.fn(async () => [this.mic]),
      trackPublications: new Map<string, { track: unknown; trackSid: string }>(),
      publishTrack: vi.fn(async (track: unknown) => {
        this.localParticipant.trackPublications.set('TR_mic', { track, trackSid: 'TR_mic' })
      }),
      unpublishTrack: vi.fn(async () => {
        this.localParticipant.trackPublications.clear()
      }),
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.events.set(event, [...(this.events.get(event) ?? []), fn])
      return this
    }
    rejectConnect?: (e: Error) => void
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.events.get(event) ?? []) fn(...args)
    }
    connect = vi.fn(async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          this.rejectConnect = reject
          Promise.resolve(media.connect?.()).then(resolve, reject)
        })
      } finally {
        this.rejectConnect = undefined
      }
    })
    startAudio = vi.fn(async () => {})
    disconnect = vi.fn(async () => {
      this.rejectConnect?.(new Error('Connection cancelled'))
      this.emit('Disconnected')
    })
    constructor(public options: { disconnectOnPageLeave?: boolean; singlePeerConnection?: boolean }) {
      media.rooms.push(this)
    }
  }
  const media = { rooms: [] as MockRoom[], connect: undefined as undefined | (() => Promise<void>) }
  return { media, MockRoom }
})
vi.mock('~/utils/voice-processor', () => ({
  MicProcessor: class {
    resume = vi.fn(async () => {})
    destroy = vi.fn(async () => {})
  },
}))
vi.mock('livekit-server-sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    getParticipant = vi.fn(async () => ({ identity: 'connected' }))
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
      'TrackMuted',
      'TrackUnmuted',
      'LocalTrackPublished',
      'LocalTrackUnpublished',
      'ActiveSpeakersChanged',
    ].map(name => [name, name]),
  ),
  Room: MockRoom,
  DisconnectReason: { UNKNOWN_REASON: 0, SIGNAL_CLOSE: 9, STATE_MISMATCH: 6, CONNECTION_TIMEOUT: 14, SERVER_SHUTDOWN: 3, MEDIA_FAILURE: 15 },
}))

type Frame = Record<string, unknown>
let clients: Array<{ userId: string; receive: (m: Frame) => void; owner: { send: (s: string) => void } }>
let frames: Frame[]
let ack: boolean
let leaveBrowsers: Array<() => Promise<void>>
let db: ReturnType<typeof createDb>
const sound = vi.fn()
const toast = vi.fn()
const navigateTo = vi.fn()
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

async function browser(userId: string, initiallyConnected = true) {
  vi.resetModules()
  const handlers = new Set<(m: Frame) => void>()
  const connected = ref(initiallyConnected)
  let opened = () => {}
  const receive = (m: Frame) => {
    for (const h of handlers) h(m)
  }
  const owner = {
    send: (s: string) => {
      if (ack) receive(JSON.parse(s))
    },
  }
  const send = vi.fn((m: Frame) => {
    if (!connected.value) return false
    handleVoiceFrame(userId, m, owner)
    return true
  })
  clients.push({ userId, receive, owner })
  mocks.useSocket.mockImplementation(() => ({
    connected,
    lost: ref(false),
    send,
    on: (h: (m: Frame) => void) => {
      handlers.add(h)
      return () => handlers.delete(h)
    },
    onOpen: (fn: () => void) => {
      opened = fn
    },
  }))
  const me = ref<{ id: string } | null>({ id: userId })
  mocks.useMe.mockImplementation(() => ({ data: me }))
  const mod = await import('~/composables/useVoice')
  mod.useVoiceLive()
  const v = mod.useVoice()
  leaveBrowsers.push(() => v.leave(false))
  const restoreAfterUpdate = mocks.onMounted.mock.calls.at(-2)![0] as () => void
  return { ...mod, v, receive, send, connected, handlers, owner, me, restoreAfterUpdate, opened: () => opened() }
}

beforeEach(() => {
  sessionStorage.clear()
  db = createDb(':memory:')
  db.insert(channels)
    .values([
      { id: 'c1', type: 'voice', name: 'One' },
      { id: 'c2', type: 'voice', name: 'Two' },
      { id: 'text', type: 'text', name: 'Text' },
    ])
    .run()
  clients = []
  leaveBrowsers = []
  frames = []
  ack = true
  media.rooms = []
  media.connect = undefined
  sound.mockClear()
  toast.mockClear()
  navigateTo.mockClear()
  mocks.useLocalStorage.mockImplementation((_: string, value: unknown) => ref(value))
  mocks.useVoiceSettings.mockImplementation(() => ref({ noise: 'standard', sensitivity: 50, outputVolume: 1 }))
  mocks.useToast.mockImplementation(() => ({ add: toast }))
  mocks.useSounds.mockImplementation(() => ({ data: ref([]) }))
  mocks.playVoiceSound.mockImplementation(sound)
  mocks.navigateTo.mockImplementation(navigateTo)
  mocks.useWakeLock.mockImplementation(() => ({ request: async () => {}, release: async () => {} }))
  vi.stubGlobal(
    '$fetch',
    vi.fn(async () => ({ token: 'token', url: 'url' })),
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }), enumerateDevices: async () => [] },
  })
  vi.stubGlobal('useRuntimeConfig', () => ({ livekit: { apiKey: 'key', apiSecret: 'secret' }, public: { livekitUrl: 'wss://rtc.example.com' } }))
  vi.stubGlobal('useDb', () => db)
  for (const [name, fn] of Object.entries(sessions)) vi.stubGlobal(name, fn)
  vi.stubGlobal('broadcast', (m: Frame) => {
    frames.push(m)
    for (const c of clients) c.receive(m)
  })
  vi.stubGlobal('sendToUser', (id: string, m: Frame) => {
    for (const c of clients.filter(c => c.userId === id)) c.receive(m)
  })
})
afterEach(async () => {
  for (const leave of leaveBrowsers) await leave()
  for (const c of clients) sessions.dropVoiceOwner(c.owner)
  db.$client.close()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'audioSession')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('call audio intent', () => {
  function audioSession(type = 'auto') {
    const session = {
      get type() {
        return type
      },
      set type(value: string) {
        type = value
      },
    }
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session })
    return session
  }

  it('sets intent before capture, keeps it while muted and reconnecting, and restores the previous type on leave', async () => {
    const session = audioSession('playback')
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async () => {
      expect(session.type).toBe('play-and-record')
      return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    })
    const b = await browser('audio-intent')
    expect(session.type).toBe('playback')
    await b.v.join('c1')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    b.v.toggleMic()
    b.v.toggleHeadphones()
    media.rooms[0]!.emit('Reconnecting')
    expect(session.type).toBe('play-and-record')
    media.rooms[0]!.emit('Reconnected')
    expect(session.type).toBe('play-and-record')
    await b.v.leave(false)
    expect(session.type).toBe('playback')
  })

  it('keeps call intent when microphone permission is denied', async () => {
    const session = audioSession()
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new Error('Denied'))
    const b = await browser('audio-listen-only')
    await b.v.join('c1')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('unavailable'))
    expect(session.type).toBe('play-and-record')
    await b.v.leave(false)
    expect(session.type).toBe('auto')
  })

  it('restores intent when joining fails', async () => {
    const session = audioSession()
    media.connect = async () => {
      throw new Error('Connection failed')
    }
    const b = await browser('audio-failed')
    await b.v.join('c1')
    expect(session.type).toBe('auto')
    expect(b.v.channelId.value).toBeNull()
  })

  it('restores intent only once on cancellation and supports a subsequent join', async () => {
    const session = audioSession()
    const setType = vi.spyOn(session, 'type', 'set')
    media.connect = () => new Promise<void>(() => {})
    const b = await browser('audio-cancelled')
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(media.rooms[0]?.connect).toHaveBeenCalled())
    expect(session.type).toBe('play-and-record')
    await b.v.leave(false)
    await joining
    expect(session.type).toBe('auto')
    expect(setType.mock.calls).toEqual([['play-and-record'], ['auto']])
    media.connect = undefined
    await b.v.join('c2')
    expect(session.type).toBe('play-and-record')
    await b.v.leave(false)
    expect(session.type).toBe('auto')
  })

  it('joins normally without Audio Session support', async () => {
    const b = await browser('audio-unsupported')
    await b.v.join('c1')
    expect(b.v.channelId.value).toBe('c1')
    await b.v.leave(false)
  })

  it('does not prevent joining when the browser rejects the session type', async () => {
    const session = audioSession()
    vi.spyOn(session, 'type', 'set').mockImplementation(() => {
      throw new Error('Unsupported')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const b = await browser('audio-rejected')
    await b.v.join('c1')
    expect(b.v.channelId.value).toBe('c1')
    expect(warn).toHaveBeenCalledWith('Could not set call audio intent', expect.any(Error))
    await b.v.leave(false)
  })
})

describe('optimistic voice display', () => {
  it('shows self immediately during a delayed token request, not to observers, then deduplicates confirmation', async () => {
    let authorize!: (token: { token: string; url: string }) => void
    vi.stubGlobal(
      '$fetch',
      vi.fn(
        () =>
          new Promise(resolve => {
            authorize = resolve
          }),
      ),
    )
    const observer = await browser('observer')
    const b = await browser('self')
    const joining = b.v.join('c1')
    expect(b.v.pendingChannelId.value).toBe('c1')
    expect(b.v.channelId.value).toBeNull()
    expect(b.voiceDisplayMembers('c1', 'self')).toEqual([expect.objectContaining({ userId: 'self', pending: true, cam: false, screen: false })])
    expect(b.voiceMembers('c1')).toEqual([])
    expect(b.v.tiles.value).toEqual([])
    expect(observer.voiceDisplayMembers('c1', 'observer')).toEqual([])
    expect(sessions.voiceSnapshot()).toEqual([])
    // A presence refresh/handoff must not duplicate self or expose media controls while pending.
    b.receive({ type: 'voice:presence', userId: 'self', channelId: 'c1', cam: true })
    expect(b.voiceDisplayMembers('c1', 'self')).toEqual([expect.objectContaining({ userId: 'self', pending: true, cam: false })])
    authorize({ token: 'token', url: 'url' })
    await joining
    expect(b.v.pendingChannelId.value).toBeNull()
    expect(b.voiceDisplayMembers('c1', 'self')).toEqual([expect.objectContaining({ userId: 'self', pending: false })])
    expect(observer.voiceMembers('c1')).toHaveLength(1)
  })

  it.each(['failure', 'cancel', 'takeover', 'admin'])('clears pending membership immediately on %s', async action => {
    let reject!: (error: Error) => void
    vi.stubGlobal(
      '$fetch',
      vi.fn(
        (_url, options: { signal: AbortSignal }) =>
          new Promise((_resolve, fail) => {
            reject = fail
            options.signal.addEventListener('abort', () => fail(options.signal.reason), { once: true })
          }),
      ),
    )
    const b = await browser('self')
    const joining = b.v.join('c1')
    expect(b.voiceDisplayMembers('c1', 'self')).toHaveLength(1)
    if (action === 'failure') reject(new Error('Token failed'))
    else if (action === 'cancel') await b.v.leave(false)
    else if (action === 'takeover') b.receive({ type: 'voice:kicked', sid: 'successor' })
    else b.receive({ type: 'voice:disconnect', sid: b.v.sid, reason: 'Admin disconnected you' })
    await joining
    expect(b.v.pendingChannelId.value).toBeNull()
    expect(b.v.channelId.value).toBeNull()
    expect(b.voiceDisplayMembers('c1', 'self')).toEqual([])
    expect(b.v.connecting.value).toBe(false)
    expect(b.send.mock.calls.some(([m]) => m.type === 'voice:ready')).toBe(false)
  })

  it.each(['cancel', 'admin move'])('honors %s while switching channels during delayed teardown', async action => {
    const b = await browser('self')
    await b.v.join('c1')
    let finish!: () => void
    media.rooms[0]!.disconnect.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const switching = b.v.join('c2')
    expect(b.v.pendingChannelId.value).toBe('c2')
    expect(b.voiceDisplayMembers('c2', 'self')).toHaveLength(1)
    if (action === 'cancel') await b.v.leave(false)
    else b.receive({ type: 'voice:move', sid: b.v.sid, channelId: 'c1' })
    expect(b.v.pendingChannelId.value).toBeNull()
    finish()
    await switching
    if (action === 'admin move') await vi.waitFor(() => expect(b.v.channelId.value).toBe('c1'))
    expect(media.rooms).toHaveLength(action === 'cancel' ? 1 : 2)
    expect(b.v.channelId.value).toBe(action === 'cancel' ? null : 'c1')
    expect(b.v.connecting.value).toBe(false)
  })
})

describe('acknowledged voice join', () => {
  it('prepares voice code on mount without requesting microphone access or joining', async () => {
    const capture = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
    const b = await browser('preload')
    const mounted = mocks.onMounted.mock.calls[0]![0] as () => void
    mounted()
    await flush()
    expect(capture).not.toHaveBeenCalled()
    expect(media.rooms).toHaveLength(0)
    expect(b.send).not.toHaveBeenCalled()
  })

  it('connects and starts listening while microphone permission is still pending', async () => {
    let allow!: (stream: MediaStream) => void
    const permission = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(
      () =>
        new Promise(resolve => {
          allow = resolve
        }),
    )
    let authorize!: (token: { token: string; url: string }) => void
    const token = vi.fn(
      () =>
        new Promise<{ token: string; url: string }>(resolve => {
          authorize = resolve
        }),
    )
    vi.stubGlobal('$fetch', token)
    const b = await browser('parallel')
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(permission).toHaveBeenCalled())
    expect(token).toHaveBeenCalledWith('/api/voice/token', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(media.rooms).toHaveLength(0)
    authorize({ token: 'token', url: 'url' })
    await joining
    const r = media.rooms[0]!
    expect(b.v.channelId.value).toBe('c1')
    expect(b.v.connecting.value).toBe(false)
    expect(b.v.connectionLabel.value).toBe('Connected · Setting up microphone…')
    expect(r.startAudio).toHaveBeenCalled()
    expect(r.localParticipant.createTracks).not.toHaveBeenCalled()
    expect(sessions.voiceSnapshot().find(p => p.userId === 'parallel')).toMatchObject({ muted: true })
    const stop = vi.fn()
    allow({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    expect(stop).toHaveBeenCalled()
    expect(r.localParticipant.publishTrack).toHaveBeenCalledWith(r.mic)
    await vi.waitFor(() => expect(sessions.voiceSnapshot().find(p => p.userId === 'parallel')).toMatchObject({ muted: false }))
    await b.v.leave()
  })

  it('keeps listening when microphone permission is denied and can retry without reconnecting', async () => {
    const b = await browser('denied')
    const capture = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new Error('NotAllowedError'))
    await b.v.join('c1')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('unavailable'))
    expect(b.v.channelId.value).toBe('c1')
    expect(media.rooms[0]!.disconnect).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Microphone access was denied' }))
    expect(b.v.connecting.value).toBe(false)
    capture.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream)
    await b.v.enableMicrophone()
    expect(b.v.microphone.value).toBe('ready')
    expect(media.rooms).toHaveLength(1)
    await b.v.leave()
  })

  it('keeps voice connected through the unload prompt and only leaves on pagehide', async () => {
    const b = await browser('reload')
    await b.v.join('c1')
    const r = media.rooms[0]!
    expect(r.options.disconnectOnPageLeave).toBe(false)
    expect(r.options.singlePeerConnection).toBe(false)
    const beforeUnload = mocks.useEventListener.mock.calls.find(([, event]) => event === 'beforeunload')![2]
    const pageHide = mocks.useEventListener.mock.calls.find(([, event]) => event === 'pagehide')![2]
    sound.mockClear()

    // Cancelling the prompt does not fire pagehide; another reload must still warn.
    for (let i = 0; i < 2; i++) {
      const event = new Event('beforeunload', { cancelable: true })
      beforeUnload(event)
      expect(event.defaultPrevented).toBe(true)
      expect(r.disconnect).not.toHaveBeenCalled()
      expect(b.v.channelId.value).toBe('c1')
      expect(sessions.sessionOf('reload')?.channelId).toBe('c1')
    }

    pageHide()
    await flush()
    expect(r.disconnect).toHaveBeenCalledTimes(1)
    expect(b.v.channelId.value).toBeNull()
    expect(sessions.sessionOf('reload')).toBeNull()
    expect(sound).not.toHaveBeenCalled()
  })

  it('rejoins once after an update when auth and the socket are ready, preserving deafen and its restore state', async () => {
    const b = await browser('update')
    await b.v.join('c1')
    b.v.toggleHeadphones()
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    b.v.reloadForUpdate()
    expect(reload).toHaveBeenCalledOnce()
    expect(JSON.parse(sessionStorage.getItem('spk:update-voice')!)).toEqual({
      userId: 'update',
      channelId: 'c1',
      mute: { muted: true, deafened: true, restore: false },
    })
    const beforeUnload = mocks.useEventListener.mock.calls.find(([, event]) => event === 'beforeunload')![2]
    const event = new Event('beforeunload', { cancelable: true })
    beforeUnload(event)
    expect(event.defaultPrevented).toBe(false)
    await b.v.leave(false)

    const next = await browser('update', false)
    next.me.value = null
    next.restoreAfterUpdate()
    expect(sessionStorage.getItem('spk:update-voice')).toBeNull()
    next.connected.value = true
    await flush()
    expect(next.v.channelId.value).toBeNull()
    next.me.value = { id: 'update' }
    await vi.waitFor(() => expect(next.v.channelId.value).toBe('c1'))
    expect(media.rooms.at(-1)!.mic.mute).toHaveBeenCalled()
    expect(sessions.voiceSnapshot().find(p => p.userId === 'update')).toMatchObject({ muted: true, deafened: true })
    next.v.toggleHeadphones()
    expect(next.v.mute.value).toEqual({ muted: false, deafened: false, restore: false })
    await next.v.leave(false)
    next.connected.value = false
    await flush()
    next.connected.value = true
    await flush()
    expect(next.v.channelId.value).toBeNull()
  })

  it.each(['reload', 'navigate', 'back_forward'])('only restores an ordinary departure on reload (%s)', async type => {
    const b = await browser('reload')
    await b.v.join('c1')
    b.v.toggleHeadphones()
    const pageHide = mocks.useEventListener.mock.calls.find(([, event]) => event === 'pagehide')![2]
    pageHide()
    await flush()
    expect(JSON.parse(sessionStorage.getItem('spk:update-voice')!)).toEqual({
      userId: 'reload',
      channelId: 'c1',
      mute: { muted: true, deafened: true, restore: false },
      reloadOnly: true,
    })

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type } as PerformanceNavigationTiming])
    const next = await browser('reload', false)
    next.me.value = null
    next.restoreAfterUpdate()
    expect(sessionStorage.getItem('spk:update-voice')).toBeNull()
    next.connected.value = true
    await flush()
    expect(next.v.channelId.value).toBeNull()
    next.me.value = { id: 'reload' }
    await flush()
    expect(next.v.channelId.value).toBe(type === 'reload' ? 'c1' : null)
    if (type === 'reload') {
      expect(next.v.mute.value).toEqual({ muted: true, deafened: true, restore: false })
      expect(next.v.camOn.value).toBe(false)
      expect(next.v.screenOn.value).toBe(false)
      await next.v.leave(false)
      next.connected.value = false
      await flush()
      next.connected.value = true
      await flush()
      expect(next.v.channelId.value).toBeNull()
    }
  })

  it.each(['leave', 'disconnect', 'takeover'])('does not save reload intent after %s', async action => {
    const b = await browser('departed')
    await b.v.join('c1')
    if (action === 'leave') await b.v.leave(false)
    else if (action === 'disconnect') b.receive({ type: 'voice:disconnect', sid: b.v.sid, reason: 'Disconnected by admin' })
    else b.receive({ type: 'voice:kicked', sid: 'another-tab' })
    await flush()
    const pageHide = mocks.useEventListener.mock.calls.find(([, event]) => event === 'pagehide')![2]
    pageHide()
    expect(sessionStorage.getItem('spk:update-voice')).toBeNull()
  })

  it('still releases media on pagehide when storage is unavailable', async () => {
    const b = await browser('storage')
    await b.v.join('c1')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    const pageHide = mocks.useEventListener.mock.calls.find(([, event]) => event === 'pagehide')![2]
    expect(() => pageHide()).not.toThrow()
    await flush()
    expect(media.rooms[0]!.disconnect).toHaveBeenCalledOnce()
    expect(b.v.channelId.value).toBeNull()
    expect(sessions.sessionOf('storage')).toBeNull()
  })

  it.each(['{', '{}', '{"userId":"ordinary","channelId":"c1","mute":{"muted":false,"deafened":true,"restore":false}}'])(
    'ignores malformed resume intent: %s',
    async saved => {
      sessionStorage.setItem('spk:update-voice', saved)
      const b = await browser('ordinary')
      b.restoreAfterUpdate()
      await flush()
      expect(media.rooms).toHaveLength(0)
      expect(sessionStorage.getItem('spk:update-voice')).toBeNull()
    },
  )

  it('does not autojoin without saved intent or restore another account’s intent', async () => {
    const b = await browser('ordinary')
    b.restoreAfterUpdate()
    await flush()
    expect(media.rooms).toHaveLength(0)
    sessionStorage.setItem(
      'spk:update-voice',
      JSON.stringify({
        userId: 'other',
        channelId: 'c1',
        mute: { muted: false, deafened: false, restore: false },
      }),
    )
    b.restoreAfterUpdate()
    await flush()
    expect(media.rooms).toHaveLength(0)
    expect(sessionStorage.getItem('spk:update-voice')).toBeNull()
  })

  it.each([false, true])('consumes the intent even when reconnecting fails (reloadOnly: %s)', async reloadOnly => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as PerformanceNavigationTiming])
    sessionStorage.setItem(
      'spk:update-voice',
      JSON.stringify({
        userId: 'failed-update',
        channelId: 'c1',
        reloadOnly,
        mute: { muted: true, deafened: false, restore: true },
      }),
    )
    media.connect = async () => {
      throw new Error('Offline')
    }
    const b = await browser('failed-update')
    b.restoreAfterUpdate()
    await flush()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not join voice' }))
    expect(sessionStorage.getItem('spk:update-voice')).toBeNull()
    b.connected.value = false
    await flush()
    b.connected.value = true
    await flush()
    expect(media.rooms).toHaveLength(1)
    expect(b.v.channelId.value).toBeNull()
  })

  it('keeps mute across leave and applies it on join', async () => {
    const b = await browser('mute')
    b.v.toggleMic()
    await b.v.join('c1')
    expect(sessions.voiceSnapshot().find(p => p.userId === 'mute')).toMatchObject({ muted: true })
    await b.v.leave()
    expect(b.v.mute.value.muted).toBe(true)
  })

  it('stays hidden while LiveKit connects and shows once connected', async () => {
    const b = await browser('late')
    let release!: () => void
    media.connect = () => new Promise<void>(r => (release = r))
    const joining = b.v.join('c1')
    await flush()
    expect(sessions.voiceSnapshot().some(p => p.userId === 'late')).toBe(false)
    expect(b.voiceDisplayMembers('c1', 'late')).toEqual([expect.objectContaining({ userId: 'late', pending: true })])
    expect(b.voiceMembers('c1')).toEqual([])
    expect(b.v.channelId.value).toBeNull()
    release()
    await joining
    expect(b.send.mock.calls.some(([m]) => m.type === 'voice:ready')).toBe(true)
    expect(sessions.voiceSnapshot().some(p => p.userId === 'late')).toBe(true)
    expect(b.v.pendingChannelId.value).toBeNull()
    expect(b.voiceDisplayMembers('c1', 'late')).toEqual([expect.objectContaining({ userId: 'late', pending: false })])
  })

  it('prepares the microphone during connection but waits to publish and respects a mute changed meanwhile', async () => {
    const b = await browser('overlap')
    let release!: () => void
    media.connect = () => new Promise<void>(resolve => (release = resolve))
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(media.rooms[0]?.mic.setProcessor).toHaveBeenCalled())
    const r = media.rooms[0]!
    expect(r.localParticipant.publishTrack).not.toHaveBeenCalled()
    expect(b.v.channelId.value).toBeNull()
    b.v.toggleMic()
    r.localParticipant.publishTrack.mockImplementation(async () => {
      expect(r.mic.mute).toHaveBeenCalled()
    })
    release()
    await joining
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    expect(sessions.voiceSnapshot().find(p => p.userId === 'overlap')).toMatchObject({ muted: true })
  })

  it('does not let slow playback startup block joining or microphone setup', async () => {
    const b = await browser('slow-playback')
    let release!: () => void
    media.connect = async () => {
      media.rooms[0]!.startAudio.mockImplementation(() => new Promise<void>(resolve => (release = resolve)))
    }
    await b.v.join('c1')
    expect(b.v.channelId.value).toBe('c1')
    expect(b.v.connecting.value).toBe(false)
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    release()
    await flush()
  })

  it('initializes the processor before muting and publishes only after capture is released', async () => {
    const b = await browser('early')
    b.v.toggleMic()
    const order: string[] = []
    media.connect = async () => {
      const r = media.rooms[0]!
      r.localParticipant.createTracks.mockImplementation(async () => {
        r.mic.setProcessor.mockImplementation(async () => {
          order.push('processor')
        })
        r.mic.mute.mockImplementation(async () => {
          expect(r.mic.stopOnMute).toBe(true)
          order.push('mute')
        })
        return [r.mic]
      })
      r.localParticipant.publishTrack.mockImplementation(async () => {
        order.push('publish')
      })
    }
    await b.v.join('c1')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    expect(order).toEqual(['processor', 'mute', 'publish', 'mute']) // trailing mute: applyMute on the published track
    expect(media.rooms[0]!.mic.setProcessor).toHaveBeenCalledWith(expect.any(Object))
  })

  it('stops microphone capture that arrives after a pending join is cancelled', async () => {
    const b = await browser('cancel-mic')
    let release!: () => void
    media.connect = async () => {
      const r = media.rooms[0]!
      r.localParticipant.createTracks.mockImplementation(async () => {
        await new Promise<void>(resolve => {
          release = resolve
        })
        return [r.mic]
      })
    }
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await b.v.leave(false)
    release()
    await joining
    await vi.waitFor(() => expect(media.rooms[0]!.mic.stop).toHaveBeenCalled())
    expect(media.rooms[0]!.mic.setProcessor).not.toHaveBeenCalled()
    expect(media.rooms[0]!.localParticipant.publishTrack).not.toHaveBeenCalled()
  })

  it('does not let late microphone capture disturb a newer channel', async () => {
    const b = await browser('late-mic')
    let release!: () => void
    media.connect = async () => {
      const r = media.rooms[0]!
      r.localParticipant.createTracks.mockImplementation(async () => {
        await new Promise<void>(resolve => {
          release = resolve
        })
        return [r.mic]
      })
    }
    await b.v.join('c1')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const original = media.rooms[0]!
    media.connect = undefined
    await b.v.join('c2')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    release()
    await vi.waitFor(() => expect(original.mic.stop).toHaveBeenCalled())
    expect(original.localParticipant.publishTrack).not.toHaveBeenCalled()
    expect(b.v.channelId.value).toBe('c2')
    expect(b.v.microphone.value).toBe('ready')
    expect(media.rooms[1]!.mic.stop).not.toHaveBeenCalled()
  })

  it('keeps listening and releases capture if microphone processing fails', async () => {
    const b = await browser('processor-failed')
    media.connect = async () => {
      media.rooms[0]!.mic.setProcessor.mockRejectedValueOnce(new Error('Processor failed'))
    }
    await b.v.join('c1')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('unavailable'))
    const r = media.rooms[0]!
    expect(r.mic.stop).toHaveBeenCalled()
    expect(r.localParticipant.publishTrack).not.toHaveBeenCalled()
    expect(r.disconnect).not.toHaveBeenCalled()
    expect(b.v.channelId.value).toBe('c1')
    expect(sessions.voiceSnapshot().find(p => p.userId === 'processor-failed')).toMatchObject({ muted: true })
  })

  it('replaces the middle browser before connecting, without observer sounds or reordering', async () => {
    const observer = await browser('first')
    await observer.v.join('c1')
    const old = await browser('middle')
    await old.v.join('c1')
    sessions.joinVoice('last', 'c1', 'last', {})
    observer.receive({ type: 'voice:presence', ...sessions.voiceSnapshot().find(p => p.userId === 'last') })
    const observerRoom = observer.v.activeRoom()! as unknown as InstanceType<typeof MockRoom>
    observerRoom.localParticipant.identity = 'first'
    const participant = (identity: string) => ({
      identity,
      isLocal: false,
      getTrackPublication: () => undefined,
      trackPublications: new Map(),
      audioTrackPublications: new Map(),
      videoTrackPublications: new Map(),
    })
    observerRoom.remoteParticipants.set('middle', participant('middle'))
    observerRoom.remoteParticipants.set('last', participant('last'))
    observerRoom.emit('ParticipantConnected')
    expect(observer.v.tiles.value.map(t => t.userId)).toEqual(['first', 'middle', 'last'])
    const next = await browser('middle')
    sound.mockClear()
    frames = []
    media.connect = async () => {
      expect(sessions.sessionOf('middle')?.sid).toBe(next.v.sid)
      expect(old.v.channelId.value).toBeNull()
      expect(next.v.channelId.value).toBeNull()
      dropVoiceSocket(old.owner)
      observerRoom.remoteParticipants.delete('middle')
      observerRoom.emit('ParticipantDisconnected')
      await flush()
      expect(observer.v.tiles.value.map(t => t.userId)).toEqual(['first', 'middle', 'last'])
      expect(observer.v.tiles.value[1]).toMatchObject({ local: false, camLive: false, screenLive: false })
      observerRoom.remoteParticipants.set('middle', participant('middle'))
      observerRoom.emit('ParticipantConnected')
    }
    await next.v.join('c1')
    expect([...observerRoom.remoteParticipants.keys()]).toEqual(['last', 'middle'])
    expect(observer.v.tiles.value.map(t => t.userId)).toEqual(['first', 'middle', 'last'])
    expect(observer.voiceMembers('c1').map(p => p.userId)).toEqual(['first', 'middle', 'last'])
    expect(frames.filter(m => m.userId === 'middle').every(m => m.channelId === 'c1')).toBe(true)
    expect(sound.mock.calls).toEqual([['join']])
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'You joined voice from another tab or device' }))
    expect(next.handlers.size).toBe(1)
    await next.v.leave()
    expect(observer.voiceMembers('c1').map(p => p.userId)).toEqual(['first', 'last'])
    expect(observer.v.tiles.value.map(t => t.userId)).toEqual(['first', 'last'])
    observer.receive({ type: 'voice:presence', userId: 'last', channelId: 'c2' })
    expect(observer.v.tiles.value.map(t => t.userId)).toEqual(['first', 'last'])
    observerRoom.remoteParticipants.delete('last')
    observerRoom.emit('ParticipantDisconnected')
    expect(observer.v.tiles.value.map(t => t.userId)).toEqual(['first'])
    await observer.v.leave(false)
    sessions.leaveVoice('last', 'last')
  })

  it('waits for the matching owner acknowledgement and cleans up a failed connection', async () => {
    const b = await browser('middle')
    ack = false
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(b.handlers.size).toBe(2))
    const r = media.rooms[0]!
    const nonce = b.send.mock.calls.find(([m]) => m.type === 'voice:join')![0].nonce
    b.receive({ type: 'voice:joined', sid: 'other', channelId: 'c1', nonce })
    b.receive({ type: 'voice:joined', sid: b.v.sid, channelId: 'c2', nonce })
    b.receive({ type: 'voice:joined', sid: b.v.sid, channelId: 'c1', nonce: 'previous-attempt' })
    await flush()
    expect(r.connect).not.toHaveBeenCalled()
    media.connect = async () => {
      throw new Error('LiveKit failed')
    }
    b.receive({ type: 'voice:joined', sid: b.v.sid, channelId: 'c1', nonce })
    await joining
    expect(sessions.sessionOf('middle')).toBeNull()
    expect(r.disconnect).toHaveBeenCalled()
    expect(b.v.activeRoom()).toBeUndefined()
    expect(b.handlers.size).toBe(1)
    expect(sound).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'LiveKit failed' }))
  })

  it('times out without leaking a claimed session, timer or acknowledgement listener', async () => {
    const b = await browser('middle')
    vi.useFakeTimers()
    ack = false
    const joining = b.v.join('c1')
    await flush()
    expect(b.handlers.size).toBe(2)
    await vi.advanceTimersByTimeAsync(5000)
    await joining
    expect(sessions.sessionOf('middle')).toBeNull()
    expect(b.handlers.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(media.rooms[0]!.connect).not.toHaveBeenCalled()
  })

  it('cancels a pending takeover without connecting or removing its successor', async () => {
    const b = await browser('middle')
    ack = false
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(b.handlers.size).toBe(2))
    handleVoiceFrame('middle', { type: 'voice:join', sid: 'successor', channelId: 'c1' }, { send: vi.fn() })
    await joining
    expect(media.rooms[0]!.connect).not.toHaveBeenCalled()
    expect(sessions.sessionOf('middle')?.sid).toBe('successor')
    expect(b.handlers.size).toBe(1)
    expect(b.v.connecting.value).toBe(false)
    expect(b.v.pendingChannelId.value).toBeNull()
    expect(toast.mock.calls).toEqual([[expect.objectContaining({ title: 'You joined voice from another tab or device' })]])
    sessions.leaveVoice('middle', 'successor')
  })

  it('cleans up an in-flight connection on socket loss', async () => {
    const b = await browser('middle')
    let finish!: () => void
    media.connect = () =>
      new Promise<void>(resolve => {
        finish = resolve
      })
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    b.connected.value = false
    dropVoiceSocket(b.owner)
    expect(media.rooms[0]!.disconnect).toHaveBeenCalled()
    finish()
    await joining
    expect(b.v.channelId.value).toBeNull()
    expect(b.v.activeRoom()).toBeUndefined()
    expect(sound).not.toHaveBeenCalled()
    expect(b.handlers.size).toBe(1)
  })

  it('honors a matching admin move during connection only after cancelling the original claim and media', async () => {
    const b = await browser('middle')
    let finish!: () => void
    media.connect = () =>
      new Promise<void>(resolve => {
        finish = resolve
      })
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const original = media.rooms[0]!
    b.receive({ type: 'voice:move', sid: 'other', channelId: 'c2' })
    await flush()
    expect(original.disconnect).not.toHaveBeenCalled()
    expect(sessions.sessionOf('middle')?.channelId).toBe('c1')
    media.connect = async () => {
      expect(original.disconnect).toHaveBeenCalled()
      expect(original.mic.stop).toHaveBeenCalled()
      expect(original.localParticipant.publishTrack).not.toHaveBeenCalled()
      expect(sessions.sessionOf('middle')?.channelId).toBe('c2')
    }
    b.receive({ type: 'voice:move', sid: b.v.sid, channelId: 'c2' })
    expect(sessions.sessionOf('middle')).toBeNull()
    expect(b.v.channelId.value).toBeNull()
    expect(b.v.pendingChannelId.value).toBeNull()
    await joining
    await vi.waitFor(() => expect(b.v.channelId.value).toBe('c2'))
    finish()
    await flush()
    expect(b.v.activeRoom()).toBe(media.rooms[1]!)
    expect(b.handlers.size).toBe(1)
    expect(b.v.connecting.value).toBe(false)
    expect(sound.mock.calls).toEqual([['join']])
    expect(toast.mock.calls).toEqual([[expect.objectContaining({ title: 'An admin moved you to another voice channel' })]])
    expect(navigateTo).toHaveBeenCalledWith('/c/c2')
    media.connect = undefined
    b.receive({ type: 'voice:move', sid: 'other', channelId: 'c1' })
    await flush()
    expect(b.v.channelId.value).toBe('c2')
    b.receive({ type: 'voice:move', sid: b.v.sid, channelId: 'c1' })
    await vi.waitFor(() => expect(b.v.channelId.value).toBe('c1'))
    expect(sessions.sessionOf('middle')?.channelId).toBe('c1')
    await b.v.leave(false)
    expect(sessions.sessionOf('middle')).toBeNull()
  })

  it('cancels a queued admin move when takeover arrives during delayed disconnect cleanup', async () => {
    const b = await browser('middle')
    media.connect = () => new Promise<void>(() => {})
    const joining = b.v.join('c1')
    await vi.waitFor(() => expect(media.rooms[0]?.connect).toHaveBeenCalled())
    const original = media.rooms[0]!
    let finishDisconnect!: () => void
    const disconnecting = new Promise<void>(resolve => {
      finishDisconnect = resolve
    })
    original.disconnect.mockImplementation(async () => {
      original.rejectConnect?.(new Error('Connection cancelled'))
      original.emit('Disconnected')
      await disconnecting
    })
    b.receive({ type: 'voice:move', sid: b.v.sid, channelId: 'c2' })
    await flush()
    expect(original.disconnect).toHaveBeenCalledTimes(2) // Abort starts disconnect; catch awaits cleanup.
    expect(b.v.connecting.value).toBe(true)
    expect(sessions.sessionOf('middle')).toBeNull()
    handleVoiceFrame('middle', { type: 'voice:join', sid: 'successor', channelId: 'c1' }, { send: vi.fn() })
    b.receive({ type: 'voice:kicked', sid: 'successor' })
    media.connect = undefined
    finishDisconnect()
    await joining
    await flush()
    expect(media.rooms).toHaveLength(1)
    expect(b.send.mock.calls.filter(([m]) => m.type === 'voice:join').map(([m]) => m.channelId)).toEqual(['c1'])
    expect(original.mic.stop).toHaveBeenCalled()
    expect(original.localParticipant.publishTrack).not.toHaveBeenCalled()
    expect(b.v.channelId.value).toBeNull()
    expect(b.v.activeRoom()).toBeUndefined()
    expect(b.v.connecting.value).toBe(false)
    expect(b.handlers.size).toBe(1)
    expect(sound).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
    expect(sessions.sessionOf('middle')).toEqual({ sid: 'successor', channelId: 'c1' })
    sessions.leaveVoice('middle', 'successor')
  })

  it('fails promptly when the socket cannot send and rejects invalid channels without acknowledging', async () => {
    const b = await browser('middle')
    const send = vi.fn()
    handleVoiceFrame('middle', { type: 'voice:join', sid: 'bad', channelId: 'text' }, { send })
    expect(send).not.toHaveBeenCalled()
    b.connected.value = false
    await b.v.join('c1')
    expect(b.handlers.size).toBe(1)
    expect(media.rooms[0]!.connect).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Voice socket is not connected' }))
  })

  it('keeps ordinary join, channel change and departure sounds', async () => {
    const observer = await browser('first')
    await observer.v.join('c1')
    const other = await browser('middle')
    sound.mockClear()
    await other.v.join('c1')
    expect(sound.mock.calls).toEqual([['join'], ['join']])
    sound.mockClear()
    await Promise.all([other.v.join('c2'), other.v.join('c1')])
    expect(other.v.channelId.value).toBe('c2')
    expect(sound.mock.calls).toEqual([['leave'], ['join']])
    sound.mockClear()
    await other.v.leave()
    expect(sound.mock.calls).toEqual([['leave']])
    await observer.v.leave(false)
  })
})

describe('voice reconnection', () => {
  it('keeps membership and makes no leave/join sounds during app socket recovery', async () => {
    const observer = await browser('observer')
    await observer.v.join('c1')
    const b = await browser('afk')
    await b.v.join('c1')
    sound.mockClear()
    b.connected.value = false
    dropVoiceSocket(b.owner)
    await flush()
    expect(sessions.voiceSnapshot().find(p => p.userId === 'afk')).toBeDefined()
    b.connected.value = true
    b.opened()
    await flush()
    expect(sessions.voiceSnapshot().filter(p => p.userId === 'afk')).toHaveLength(1)
    expect(sound).not.toHaveBeenCalled()
    expect(media.rooms).toHaveLength(2)
    expect(media.rooms.every(r => r.disconnect.mock.calls.length === 0)).toBe(true)
  })

  it('keeps healthy media through an app redeploy and restores full presence state', async () => {
    const b = await browser('redeploy')
    await b.v.join('c1')
    await b.v.toggleCamera()
    const r = media.rooms.at(-1)!
    r.localParticipant.identity = 'redeploy'
    r.emit('ActiveSpeakersChanged', [r.localParticipant])
    b.connected.value = false
    dropVoiceSocket(b.owner)
    expect(r.disconnect).not.toHaveBeenCalled()
    b.connected.value = true
    b.opened()
    await vi.waitFor(() => expect(sessions.voiceSnapshot().find(p => p.userId === 'redeploy')).toMatchObject({ cam: true, speaking: true }))
    expect(b.v.activeRoom()).toBe(r)
    await b.v.leave(false)
  })

  it('keeps an avatar tile while LiveKit removes participants during a full reconnect', async () => {
    const b = await browser('recovery')
    await b.v.join('c1')
    const r = media.rooms.at(-1)!
    const participant = {
      identity: 'remote',
      isLocal: false,
      getTrackPublication: () => undefined,
      trackPublications: new Map(),
      audioTrackPublications: new Map(),
    }
    b.receive({ type: 'voice:presence', userId: 'remote', channelId: 'c1' })
    r.remoteParticipants.set('remote', participant)
    r.emit('ParticipantConnected')
    r.remoteParticipants.delete('remote')
    r.emit('ParticipantDisconnected')
    r.state = 'reconnecting'
    r.emit('Reconnecting')
    await flush()
    expect(b.v.tiles.value.find(t => t.userId === 'remote')).toMatchObject({ camLive: false, screenLive: false })
    r.remoteParticipants.set('remote', participant)
    r.state = 'connected'
    r.emit('Reconnected')
    expect(b.v.tiles.value.filter(t => t.userId === 'remote')).toHaveLength(1)
    b.receive({ type: 'voice:presence', userId: 'remote', channelId: null })
    expect(b.v.tiles.value.find(t => t.userId === 'remote')).toBeUndefined()
    await b.v.leave(false)
  })

  it('bounds ping history, shows reconnect gaps, and clears diagnostics on leave', async () => {
    const b = await browser('diagnostics')
    vi.useFakeTimers()
    await b.v.join('c1')
    await flush()
    expect(b.v.ping.value).toBe(42)
    await vi.advanceTimersByTimeAsync(70_000)
    expect(b.v.pingHistory.value.length).toBeLessThanOrEqual(33)
    expect(b.v.pingHistory.value.filter(p => p.time < Date.now() - 62_000)).toHaveLength(1)
    expect(b.v.pingHistory.value[1]!.time).toBeGreaterThanOrEqual(Date.now() - 62_000)
    const r = media.rooms.at(-1)!
    r.emit('Reconnecting')
    expect(b.v.diagnostics.value).toBeNull()
    expect(b.v.pingHistory.value.at(-1)?.ping).toBeNull()
    r.emit('Reconnected')
    await flush()
    expect(b.v.ping.value).toBe(42)
    await b.v.leave(false)
    await vi.advanceTimersByTimeAsync(4000)
    expect(b.v.pingHistory.value).toEqual([])
    expect(b.v.diagnostics.value).toBeNull()
  })

  it('does not overlap stats reads or restore measurements after leaving mid-read', async () => {
    const b = await browser('diagnostics-race')
    vi.useFakeTimers()
    await b.v.join('c1')
    await flush()
    let resolve!: (stats: undefined) => void
    const getSenderStats = vi.fn(
      () =>
        new Promise<undefined>(done => {
          resolve = done
        }),
    )
    media.rooms.at(-1)!.localParticipant.audioTrackPublications.set('mic', { audioTrack: { getSenderStats } })
    await vi.advanceTimersByTimeAsync(6000)
    expect(getSenderStats).toHaveBeenCalledTimes(1)
    await b.v.leave(false)
    resolve(undefined)
    await flush()
    expect(b.v.ping.value).toBeNull()
    expect(b.v.pingHistory.value).toEqual([])
    expect(b.v.diagnostics.value).toBeNull()
  })

  it('defers readiness while media reconnects, then restores it without starting a new room', async () => {
    const b = await browser('recovery')
    await b.v.join('c1')
    const r = media.rooms.at(-1)!
    r.emit('Reconnecting')
    r.emit('Reconnecting')
    expect(b.v.connectionLabel.value).toBe('Voice reconnecting…')
    expect(b.v.ping.value).toBeNull()
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Voice interrupted. Reconnecting…' }))
    expect(b.v.health.value).toBe('unstable')
    dropVoiceSocket(b.owner)
    b.opened()
    expect(sessions.voiceSnapshot().find(p => p.userId === 'recovery')).toBeDefined()
    r.emit('Reconnected')
    expect(b.v.connection.value).toBe('connected')
    expect(sessions.voiceSnapshot().find(p => p.userId === 'recovery')).toBeDefined()
    expect(media.rooms).toHaveLength(1)
    await b.v.leave(false)
    toast.mockClear()
    r.emit('Reconnected')
    expect(b.v.channelId.value).toBeNull()
    expect(toast).not.toHaveBeenCalled()
  })

  it('toasts a reconnect only after 5 s and turns the speaker red, keeping brief drops silent', async () => {
    const b = await browser('slow-recovery')
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    await b.v.join('c1')
    const r = media.rooms.at(-1)!
    r.emit('SignalReconnecting')
    await vi.advanceTimersByTimeAsync(2000)
    r.emit('Reconnected')
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/Voice (signaling|interrupted|connection)/) }))
    r.emit('SignalReconnecting')
    await vi.advanceTimersByTimeAsync(4999)
    expect(b.v.health.value).toBe('unstable')
    await vi.advanceTimersByTimeAsync(1)
    expect(b.v.health.value).toBe('lost')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Voice signaling reconnecting. Audio may still work.' }))
    r.emit('Reconnected')
    expect(b.v.health.value).toBe('ok')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Voice connection restored' }))
    await b.v.leave(false)
  })

  it('offers a manual retry only for transport failures and preserves deafen on rejoin', async () => {
    const b = await browser('retry')
    await b.v.join('c1')
    b.v.toggleHeadphones()
    media.rooms.at(-1)!.emit('Disconnected', 9)
    expect(b.v.retryChannelId.value).toBe('c1')
    await b.v.reconnect()
    expect(b.v.channelId.value).toBe('c1')
    expect(b.v.mute.value.deafened).toBe(true)
    media.rooms.at(-1)!.emit('Disconnected', 4)
    expect(b.v.retryChannelId.value).toBeNull()
    await b.v.reconnect()
    expect(media.rooms).toHaveLength(2)
  })

  it('cancels an explicit reconnect if another tab takes over during teardown', async () => {
    const b = await browser('retry-takeover')
    await b.v.join('c1')
    const r = media.rooms.at(-1)!
    let finish!: () => void
    r.disconnect.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const retrying = b.v.reconnect()
    expect(b.v.connecting.value).toBe(true)
    b.receive({ type: 'voice:kicked', sid: 'successor' })
    finish()
    await retrying
    expect(media.rooms).toHaveLength(1)
    expect(b.v.channelId.value).toBeNull()
  })
})

describe('one microphone publication per session', () => {
  it('unpublishes an orphaned track when publishing fails and republishes exactly once on retry', async () => {
    const b = await browser('mic-orphan')
    media.connect = async () => {
      const lp = media.rooms[0]!.localParticipant
      lp.publishTrack.mockImplementationOnce(async (track: unknown) => {
        lp.trackPublications.set('TR_mic', { track, trackSid: 'TR_mic' })
        throw new Error('publish failed')
      })
    }
    await b.v.join('c1')
    const r = media.rooms[0]!
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('unavailable'))
    expect(r.localParticipant.unpublishTrack).toHaveBeenCalledWith(r.mic)
    expect(r.localParticipant.trackPublications.size).toBe(0)
    await b.v.enableMicrophone()
    expect(b.v.microphone.value).toBe('ready')
    expect(r.localParticipant.publishTrack).toHaveBeenCalledTimes(2)
    expect(r.localParticipant.trackPublications.size).toBe(1)
  })

  it('reuses the published microphone instead of capturing and publishing again', async () => {
    const b = await browser('mic-reuse')
    await b.v.join('c1')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    const r = media.rooms[0]!
    b.v.microphone.value = 'unavailable'
    await b.v.enableMicrophone()
    expect(b.v.microphone.value).toBe('ready')
    expect(r.localParticipant.createTracks).toHaveBeenCalledTimes(1)
    expect(r.localParticipant.publishTrack).toHaveBeenCalledTimes(1)
  })

  it('mutes the published track when toggling the microphone', async () => {
    const b = await browser('mic-toggle')
    await b.v.join('c1')
    await vi.waitFor(() => expect(b.v.microphone.value).toBe('ready'))
    b.v.toggleMic()
    const r = media.rooms[0]!
    expect(r.mic.mute).toHaveBeenCalled()
  })
})

describe('webcam resolution during a call', () => {
  it('uses the saved maximum on start and applies live changes without changing screen quality', async () => {
    const { v } = await browser('camera-live')
    await v.setCameraResolution('720p')
    await v.join('c1')
    const r = media.rooms.at(-1)!
    await v.toggleCamera()
    expect(v.camOn.value).toBe(true)
    expect(r.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(true, { ...cameraConstraints('720p'), deviceId: undefined })
    const screenQuality = v.settings.value.screenQuality
    await v.setCameraResolution('360p')
    expect(r.camera.restartTrack).toHaveBeenLastCalledWith({ ...cameraConstraints('360p'), deviceId: undefined })
    expect(v.settings.value.cameraResolution).toBe('360p')
    expect(v.settings.value.screenQuality).toBe(screenQuality)
    expect(v.camOn.value).toBe(true)
    await v.setCameraResolution('auto')
    expect(r.camera.restartTrack).toHaveBeenLastCalledWith({ ...cameraConstraints('auto'), deviceId: undefined })
    await v.leave()
  })

  it('keeps the camera off when a choice changes and applies it on re-enable', async () => {
    const { v } = await browser('camera-off')
    await v.setCameraResolution('720p')
    await v.join('c1')
    const r = media.rooms.at(-1)!
    await v.toggleCamera()
    await v.toggleCamera()
    expect(v.camOn.value).toBe(false)
    await v.setCameraResolution('1080p')
    expect(r.camera.restartTrack).not.toHaveBeenCalled()
    expect(v.camOn.value).toBe(false)
    await v.toggleCamera()
    expect(r.camera.restartTrack).toHaveBeenLastCalledWith({ ...cameraConstraints('1080p'), deviceId: undefined })
    expect(v.camOn.value).toBe(true)
    await v.leave()
  })

  it('reports capture failure and retains the saved choice for retry', async () => {
    const { v } = await browser('camera-fail')
    await v.join('c1')
    await v.toggleCamera()
    const r = media.rooms.at(-1)!
    r.camera.restartTrack.mockRejectedValueOnce(new Error('Camera unavailable'))
    await v.setCameraResolution('1080p')
    expect(v.settings.value.cameraResolution).toBe('1080p')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not change camera resolution', description: 'Camera unavailable' }))
    await v.leave()
  })
})
