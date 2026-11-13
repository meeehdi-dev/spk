import type { LocalParticipant, LocalTrack, TrackPublishOptions, ScreenShareCaptureOptions } from 'livekit-client'
import type { Mock } from 'vitest'
import type { Ref } from 'vue'

import type { VoiceSettings } from '~/composables/useVoiceSettings'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { SCREEN_AUDIO_CAPTURE, SCREEN_AUDIO_PUBLISH, screenShareOptions } from '#shared/utils/voice'

const mocks = vi.hoisted(() => ({
  useLocalStorage: vi.fn(),
  useVoiceSettings: vi.fn(),
  useMe: vi.fn(),
  useToast: vi.fn(),
  playVoiceSound: vi.fn(),
  useSounds: vi.fn(),
  onMounted: vi.fn(),
  useEventListener: vi.fn(),
  useWakeLock: vi.fn(),
  useSocket: vi.fn(),
}))
mockNuxtImport('useLocalStorage', () => mocks.useLocalStorage)
mockNuxtImport('useVoiceSettings', () => mocks.useVoiceSettings)
mockNuxtImport('useMe', () => mocks.useMe)
mockNuxtImport('useToast', () => mocks.useToast)
mockNuxtImport('playVoiceSound', () => mocks.playVoiceSound)
mockNuxtImport('useSounds', () => mocks.useSounds)
mockNuxtImport('onMounted', () => mocks.onMounted)
mockNuxtImport('useEventListener', () => mocks.useEventListener)
mockNuxtImport('useWakeLock', () => mocks.useWakeLock)
mockNuxtImport('useSocket', () => mocks.useSocket)

const { media, MockRoom } = vi.hoisted(() => {
  class MockRoom {
    events = new Map<string, (() => void)[]>()
    remoteParticipants = new Map()
    localParticipant = participant('local', true)
    constructor() {
      media.rooms.push(this)
    }
    on(event: string, fn: () => void) {
      this.events.set(event, [...(this.events.get(event) ?? []), fn])
      return this
    }
    emit(event: string) {
      for (const fn of this.events.get(event) ?? []) fn()
    }
    connect = vi.fn(async () => {})
    startAudio = vi.fn(async () => {})
    disconnect = vi.fn(async () => {
      this.emit('Disconnected')
    })
  }
  const media = { rooms: [] as MockRoom[], sdk: false }
  return { media, MockRoom }
})
vi.mock('~/utils/voice-processor', () => ({ MicProcessor: vi.fn() }))
vi.mock('livekit-client', async importOriginal => {
  const sdk = await importOriginal<typeof import('livekit-client')>()
  return {
    Track: { Kind: { Audio: 'audio' } },
    LocalVideoTrack: vi.fn(function (native: ReturnType<typeof nativeTrack>) {
      return media.sdk ? new sdk.LocalVideoTrack(native as unknown as MediaStreamTrack) : track('video', 'screen_share', native)
    }),
    RoomEvent: Object.fromEntries(
      [
        'Disconnected',
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
  }
})

function participant(identity: string, isLocal = false) {
  const pubs = new Map<
    string,
    {
      track?: TestTrack
      audioTrack?: TestTrack
      videoTrack?: TestTrack
      isMuted?: boolean
      options?: TrackPublishOptions
      source?: string
      trackName?: string
      isDesired?: boolean
      setSubscribed?: (on: boolean) => void
    }
  >()
  return {
    identity,
    isLocal,
    trackPublications: pubs,
    audioTrackPublications: new Map(),
    videoTrackPublications: new Map(),
    getTrackPublication: (source: string) => pubs.get(source),
    createTracks: vi.fn(async () => [Object.assign(track('audio', 'microphone'), { stopOnMute: false, setProcessor: vi.fn(async () => {}) })]),
    createScreenTracks: vi.fn<(options: ScreenShareCaptureOptions) => Promise<ReturnType<typeof track>[]>>(),
    publishTrack: vi.fn(async (track: TestTrack, options: TrackPublishOptions) => {
      pubs.set(track.source, {
        track,
        audioTrack: track.kind === 'audio' ? track : undefined,
        videoTrack: track.kind === 'video' ? track : undefined,
        isMuted: track.isMuted,
        options,
        trackName: options?.name,
      })
      // Simulate LiveKit's VP9 hint override; the action must restore the selected hint.
      if (track.kind === 'video') track.mediaStreamTrack.contentHint = 'motion'
      media.rooms.at(-1)?.emit('LocalTrackPublished')
      return pubs.get(track.source)!
    }),
    unpublishTrack: vi.fn(async (track: TestTrack, stop = true) => {
      if (pubs.get(track.source)?.track === track) pubs.delete(track.source)
      if (stop) track.stop()
      media.rooms.at(-1)?.emit('LocalTrackUnpublished')
    }),
  }
}
type TestTrack = ReturnType<typeof track> | LocalTrack
interface NativeTrack extends EventTarget {
  readyState: string
  contentHint: string
  applyConstraints: Mock<(constraints: MediaTrackConstraints) => Promise<void>>
  getSettings: () => { width: number; height: number }
  getConstraints: () => MediaTrackConstraints
  stop: () => void
  clone: Mock<() => NativeTrack>
}
function nativeTrack(): NativeTrack {
  return Object.assign(new EventTarget(), {
    readyState: 'live',
    contentHint: '',
    applyConstraints: vi.fn(async (_constraints: MediaTrackConstraints) => {}),
    getSettings: () => ({ width: 1280, height: 720 }),
    getConstraints: () => ({}),
    stop() {
      this.readyState = 'ended'
    },
    clone: vi.fn(() => nativeTrack()),
  })
}
function track(kind: 'video' | 'audio', source = kind === 'video' ? 'screen_share' : 'screen_share_audio', native = nativeTrack()) {
  const t = {
    kind,
    source,
    mediaStreamTrack: native,
    isMuted: false,
    stop: vi.fn(() => {
      native.readyState = 'ended'
    }),
    mute: vi.fn(async () => {
      t.isMuted = true
    }),
    unmute: vi.fn(async () => {
      t.isMuted = false
    }),
  }
  return t
}
function deferred<T>() {
  let resolve!: (value?: T) => void
  const promise = new Promise<T>(r => {
    resolve = value => r(value as T)
  })
  return { promise, resolve }
}
const toast = vi.fn()
const ECO = { height: 1440, fps: 5 } as const,
  SMOOTH = { height: 1080, fps: 60 } as const
let settings: Ref<Partial<VoiceSettings>>
let v: ReturnType<typeof import('~/composables/useVoice').useVoice>
let p: ReturnType<typeof participant>
let r: InstanceType<typeof MockRoom>
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(async () => {
  vi.resetModules()
  media.rooms = []
  media.sdk = false
  toast.mockClear()
  settings = ref({ screenQuality: ECO, screenAudio: false, noise: 'enhanced', echo: true, agc: true, sensitivity: 50, outputVolume: 1 })
  mocks.useLocalStorage.mockImplementation((_: string, value: unknown) => ref(value))
  mocks.useVoiceSettings.mockImplementation(() => settings)
  mocks.useMe.mockImplementation(() => ({ data: ref({ id: 'local' }) }))
  mocks.useToast.mockImplementation(() => ({ add: toast }))
  vi.stubGlobal(
    '$fetch',
    vi.fn(async () => ({ token: 'token', url: 'url' })),
  )
  const handlers = new Set<(m: Record<string, unknown>) => void>()
  mocks.useSocket.mockImplementation(() => ({
    connected: ref(true),
    on: (fn: (m: Record<string, unknown>) => void) => {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
    send: (m: Record<string, unknown>) => {
      if (m.type === 'voice:join') for (const fn of handlers) fn({ ...m, type: 'voice:joined' })
      return true
    },
  }))
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
      enumerateDevices: async () => [],
    },
  })
  v = (await import('~/composables/useVoice')).useVoice()
  await v.join('channel')
  expect(toast.mock.calls).toEqual([])
  r = media.rooms[0]!
  p = r.localParticipant
  p.publishTrack.mockClear() // screen assertions exclude the microphone published during join
})
afterEach(async () => {
  await v.leave(false)
  vi.unstubAllGlobals()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

async function share(audio = false) {
  const video = track('video'),
    sound = audio ? track('audio') : undefined
  p.createScreenTracks.mockResolvedValueOnce([video, ...(sound ? [sound] : [])])
  settings.value.screenAudio = audio
  await v.startScreen()
  p.publishTrack.mockClear()
  p.unpublishTrack.mockClear()
  p.createScreenTracks.mockClear()
  return { video, sound, publication: p.getTrackPublication('screen_share')!.track }
}

describe('live screen settings', () => {
  it.each([true, false])('retains the saved audio choice %s when the browser returns no audio', async audio => {
    settings.value.screenAudio = audio
    p.createScreenTracks.mockResolvedValueOnce([track('video')])
    await v.startScreen()

    expect(settings.value.screenAudio).toBe(audio)
    expect(v.tiles.value[0]?.screenAudio).toBe(false)
    await v.stopScreen()
    p.createScreenTracks.mockResolvedValueOnce([track('video')])
    await v.startScreen()

    expect(p.createScreenTracks).toHaveBeenLastCalledWith(expect.objectContaining({ audio: audio ? SCREEN_AUDIO_CAPTURE : false }))
    expect(settings.value.screenAudio).toBe(audio)
  })

  it('only saves inactive preferences and starts once with their capture/publish options', async () => {
    await v.setScreenQuality(SMOOTH)
    await v.setScreenAudio(true)
    expect(p.createScreenTracks).not.toHaveBeenCalled()
    const video = track('video'),
      audio = track('audio')
    p.createScreenTracks.mockResolvedValueOnce([video, audio])
    const starting = v.startScreen()
    await v.startScreen()
    expect(p.createScreenTracks).toHaveBeenCalledTimes(1)
    await starting
    expect(p.createScreenTracks).toHaveBeenCalledWith(
      expect.objectContaining({ audio: SCREEN_AUDIO_CAPTURE, video: expect.objectContaining({ width: { max: 1920 }, frameRate: { ideal: 60, max: 60 } }) }),
    )
    expect(v.tiles.value[0]?.screenQuality).toEqual(SMOOTH)
    expect(video.mediaStreamTrack.getSettings().height).toBe(720)
    expect(p.publishTrack).toHaveBeenCalledWith(audio, SCREEN_AUDIO_PUBLISH)
    expect(p.publishTrack).toHaveBeenCalledWith(
      expect.objectContaining({ mediaStreamTrack: video.mediaStreamTrack.clone.mock.results[0]!.value }),
      expect.objectContaining({ videoCodec: 'vp9', backupCodec: { codec: 'vp8' }, screenShareEncoding: { maxBitrate: 15_000_000, maxFramerate: 60 } }),
    )
  })

  it('republishes only screen video in both directions with fresh primary/backup options and no upscaling', async () => {
    const { video, sound } = await share(true)
    const mic = track('audio', 'microphone'),
      cam = track('video', 'camera')
    p.trackPublications.set('microphone', { track: mic })
    p.trackPublications.set('camera', { track: cam })
    for (const quality of [SMOOTH, ECO]) {
      await v.setScreenQuality(quality)
      const preset = screenShareOptions(quality)
      expect(settings.value.screenQuality).toEqual(quality)
      expect(v.tiles.value[0]?.screenQuality).toEqual(quality)
      expect(video.mediaStreamTrack.getSettings()).toEqual({ width: 1280, height: 720 })
      expect(video.mediaStreamTrack.applyConstraints).toHaveBeenLastCalledWith({
        width: { max: preset.resolution.width },
        height: { max: preset.resolution.height },
        frameRate: { ideal: preset.resolution.frameRate, max: preset.resolution.frameRate },
      })
      expect(video.mediaStreamTrack.contentHint).toBe(preset.contentHint)
      expect(p.unpublishTrack).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'video' }))
      expect(p.publishTrack).toHaveBeenLastCalledWith(
        p.getTrackPublication('screen_share')!.track,
        expect.objectContaining({
          simulcast: false,
          videoCodec: 'vp9',
          backupCodec: { codec: 'vp8' },
          degradationPreference: preset.degradationPreference,
          screenShareEncoding: { maxBitrate: preset.maxBitrate, maxFramerate: preset.resolution.frameRate },
        }),
      )
      expect(v.screenOn.value).toBe(true)
    }
    expect(p.createScreenTracks).not.toHaveBeenCalled()
    expect(p.publishTrack.mock.calls.every(([t]) => t.kind === 'video' && t !== video)).toBe(true)
    expect(p.unpublishTrack.mock.calls.every(([t]) => t.kind === 'video' && t !== video)).toBe(true)
    for (const t of [video, sound!, mic, cam]) expect(t.stop).not.toHaveBeenCalled()
    expect(sound!.mute).not.toHaveBeenCalled()
    expect(p.createTracks).toHaveBeenCalledTimes(1)
  })

  it('derives remote quality without subscribing or using local preferences, and clears missing/invalid publications', async () => {
    const handlers: Array<(m: Record<string, unknown>) => void> = []
    mocks.useSocket.mockImplementation(() => ({ connected: ref(true), on: (fn: (m: Record<string, unknown>) => void) => handlers.push(fn), onOpen: vi.fn() }))
    mocks.useSounds.mockImplementation(() => ({ data: ref([]) }))
    mocks.useWakeLock.mockImplementation(() => ({ request: async () => {}, release: async () => {} }))
    const { useVoiceLive } = await import('~/composables/useVoice')
    useVoiceLive()
    for (const receive of handlers) receive({ type: 'voice:presence', userId: 'remote', channelId: 'channel' })
    const remote = participant('remote')
    const pub = { source: 'screen_share', trackName: 'spk:screen:1080:60', isDesired: false, setSubscribed: vi.fn() }
    remote.trackPublications.set('screen_share', pub)
    r.remoteParticipants.set('remote', remote)
    r.emit('TrackPublished')
    expect(settings.value.screenQuality).toEqual(ECO)
    expect(v.tiles.value.find(t => t.userId === 'remote')).toMatchObject({ screenLive: true, watching: false, screenQuality: SMOOTH })
    expect(v.tiles.value.find(t => t.userId === 'remote')?.screen).toBeUndefined()
    expect(pub.setSubscribed).not.toHaveBeenCalled()
    for (const name of ['', 'spk:screen:1080:24', 'malformed']) {
      pub.trackName = name
      r.emit('TrackPublished')
      expect(v.tiles.value.find(t => t.userId === 'remote')?.screenQuality).toBeUndefined()
    }
    pub.trackName = 'spk:screen:1440:5'
    r.emit('TrackPublished')
    expect(v.tiles.value.find(t => t.userId === 'remote')?.screenQuality).toEqual(ECO)
    remote.trackPublications.set('screen_share', { source: 'screen_share', isDesired: false, setSubscribed: vi.fn() })
    r.emit('TrackPublished')
    expect(v.tiles.value.find(t => t.userId === 'remote')?.screenQuality).toBeUndefined()
    remote.trackPublications.clear()
    remote.trackPublications.set('camera', { source: 'camera', trackName: 'spk:screen:1440:5', isDesired: false, setSubscribed: vi.fn() })
    r.emit('TrackUnpublished')
    expect(v.tiles.value.find(t => t.userId === 'remote')).toMatchObject({ screenLive: false, camLive: true })
    expect(v.tiles.value.find(t => t.userId === 'remote')?.screenQuality).toBeUndefined()
  })

  it('keeps Watch through publication gaps/later shares, but clears on unwatch, departure and local leave', async () => {
    const remote = participant('remote'),
      pub = {
        source: 'screen_share',
        isDesired: false,
        setSubscribed: vi.fn((on: boolean) => {
          pub.isDesired = on
        }),
      }
    r.remoteParticipants.set('remote', remote)
    remote.trackPublications.set('screen_share', pub)
    v.watch('remote', true)
    remote.trackPublications.clear()
    r.emit('TrackUnpublished')
    expect(v.watching.value).toEqual(['remote'])
    remote.trackPublications.set('screen_share', pub)
    r.emit('TrackPublished')
    expect(pub.setSubscribed).toHaveBeenLastCalledWith(true)
    v.watch('remote', false)
    expect(v.watching.value).toEqual([])
    expect(pub.setSubscribed).toHaveBeenLastCalledWith(false)
    v.watch('remote', true)
    r.remoteParticipants.delete('remote')
    r.emit('ParticipantDisconnected')
    expect(v.watching.value).toEqual([])
    r.remoteParticipants.set('remote', remote)
    v.watch('remote', true)
    await v.leave(false)
    expect(v.watching.value).toEqual([])
  })

  it('restores the previous quality/publication after failure, without claiming success', async () => {
    const { video } = await share()
    p.publishTrack.mockRejectedValueOnce(new Error('publish failed'))
    await v.setScreenQuality(SMOOTH)
    expect(settings.value.screenQuality).toEqual(ECO)
    expect(v.tiles.value[0]?.screenQuality).toEqual(ECO)
    expect(p.publishTrack).toHaveBeenCalledTimes(2)
    expect(p.getTrackPublication('screen_share')?.track?.mediaStreamTrack).toBe(video.mediaStreamTrack.clone.mock.results.at(-1)!.value)
    expect(video.mediaStreamTrack.contentHint).toBe('detail')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'publish failed' }))
    expect(v.screenBusy.value).toBe(false)
  })

  it('stops capture and reports the actual stopped state when restoration also fails', async () => {
    const { video } = await share()
    p.publishTrack.mockRejectedValue(new Error('offline'))
    await v.setScreenQuality(SMOOTH)
    expect(video.stop).toHaveBeenCalled()
    expect(v.screenOn.value).toBe(false)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not restore screen sharing' }))
  })

  it('stop during quality publication wins and does not restore or accept overlapping actions', async () => {
    const { video } = await share()
    const wait = deferred<undefined>()
    p.publishTrack.mockImplementationOnce(async () => {
      await wait.promise
      throw new Error('late failure')
    })
    const update = v.setScreenQuality(SMOOTH)
    await flush()
    expect(v.screenOn.value).toBe(true) // the Stop action remains available in the publication gap
    await v.setScreenQuality(ECO)
    await v.setScreenAudio(true)
    await v.stopScreen()
    wait.resolve(undefined)
    await update
    expect(p.publishTrack).toHaveBeenCalledTimes(1)
    expect(p.createScreenTracks).not.toHaveBeenCalled()
    expect(video.stop).toHaveBeenCalled()
    expect(v.screenOn.value).toBe(false)
    expect(settings.value.screenQuality).toEqual(ECO)
  })

  it('mutes/resumes only an existing screen audio track without a picker', async () => {
    const { video, sound } = await share(true)
    await v.setScreenAudio(false)
    expect(sound!.mute).toHaveBeenCalledOnce()
    expect(settings.value.screenAudio).toBe(false)
    await v.setScreenAudio(true)
    expect(sound!.unmute).toHaveBeenCalledOnce()
    expect(settings.value.screenAudio).toBe(true)
    expect(p.createScreenTracks).not.toHaveBeenCalled()
    expect(p.publishTrack).not.toHaveBeenCalled()
    expect(video.stop).not.toHaveBeenCalled()
    expect(sound!.stop).not.toHaveBeenCalled()
  })

  it('opens the audio picker synchronously, preserves the old share until success, and cleans superseded capture', async () => {
    const { video, publication } = await share()
    const wait = deferred<ReturnType<typeof track>[]>(),
      next = track('video'),
      audio = track('audio')
    p.createScreenTracks.mockReturnValueOnce(wait.promise)
    const update = v.setScreenAudio(true)
    expect(p.createScreenTracks).toHaveBeenCalledOnce() // before any await/microtask
    expect(p.getTrackPublication('screen_share')?.track).toBe(publication)
    expect(video.stop).not.toHaveBeenCalled()
    await v.setScreenAudio(true)
    expect(p.createScreenTracks).toHaveBeenCalledOnce()
    wait.resolve([next, audio])
    await update
    expect(p.getTrackPublication('screen_share')?.track?.mediaStreamTrack).toBe(next.mediaStreamTrack.clone.mock.results[0]!.value)
    expect(p.publishTrack).toHaveBeenCalledWith(audio, SCREEN_AUDIO_PUBLISH)
    expect(p.createScreenTracks).toHaveBeenCalledWith(expect.objectContaining({ audio: SCREEN_AUDIO_CAPTURE, contentHint: 'detail' }))
    expect(video.stop).toHaveBeenCalled()
    expect(next.stop).not.toHaveBeenCalled()
    expect(audio.stop).not.toHaveBeenCalled()
    expect(settings.value.screenAudio).toBe(true)
    expect(v.tiles.value[0]?.screenQuality).toEqual(ECO)
  })

  it('preserves video and reflects absent audio on cancellation, denial or a source without audio', async () => {
    const { video, publication } = await share()
    for (const name of ['NotAllowedError', 'AbortError']) {
      p.createScreenTracks.mockRejectedValueOnce(new DOMException('picker cancelled', name))
      await v.setScreenAudio(true)
      expect(p.getTrackPublication('screen_share')?.track).toBe(publication)
      expect(settings.value.screenAudio).toBe(false)
    }
    const unused = track('video')
    p.createScreenTracks.mockResolvedValueOnce([unused])
    await v.setScreenAudio(true)
    expect(unused.stop).toHaveBeenCalled()
    expect(video.stop).not.toHaveBeenCalled()
    expect(p.publishTrack).not.toHaveBeenCalled()
    expect(p.unpublishTrack.mock.calls.every(([t]) => t !== video)).toBe(true)
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: expect.stringContaining('did not provide audio') }))
  })

  it('restores the original share if replacement audio publication fails', async () => {
    const { video } = await share()
    const next = track('video'),
      audio = track('audio')
    p.createScreenTracks.mockResolvedValueOnce([next, audio])
    const publish = p.publishTrack.getMockImplementation()!
    p.publishTrack.mockImplementation(async (t, options) => {
      if (t === audio) throw new Error('audio publish failed')
      return publish(t, options)
    })
    await v.setScreenAudio(true)
    expect(p.getTrackPublication('screen_share')?.track?.mediaStreamTrack).toBe(video.mediaStreamTrack.clone.mock.results.at(-1)!.value)
    expect(video.stop).not.toHaveBeenCalled()
    expect(next.stop).toHaveBeenCalled()
    expect(audio.stop).toHaveBeenCalled()
    expect(settings.value.screenAudio).toBe(false)
    expect(v.tiles.value[0]?.screenQuality).toEqual(ECO)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'audio publish failed' }))
  })

  it('does not begin audio restoration if stopped during failed replacement cleanup', async () => {
    const { video } = await share()
    const next = track('video'),
      audio = track('audio'),
      cleanup = deferred<undefined>()
    p.createScreenTracks.mockResolvedValueOnce([next, audio])
    const publish = p.publishTrack.getMockImplementation()!,
      unpublish = p.unpublishTrack.getMockImplementation()!
    p.publishTrack.mockImplementation(async (t, options) => {
      if (t === audio) throw new Error('audio failed')
      return publish(t, options)
    })
    p.unpublishTrack.mockImplementation(async (t, stop) => {
      if (t === next && stop !== false) await cleanup.promise
      return unpublish(t, stop)
    })
    const update = v.setScreenAudio(true)
    await flush()
    await vi.waitFor(() => expect(next.stop).toHaveBeenCalled())
    const stopping = v.stopScreen()
    expect(video.mediaStreamTrack.readyState).toBe('ended')
    cleanup.resolve()
    await stopping
    await update
    expect(p.publishTrack.mock.calls.map(([t]) => t.kind)).toEqual(['video', 'audio'])
    expect(video.stop).toHaveBeenCalled()
    expect(v.screenOn.value).toBe(false)
  })

  it('cleans a successful late video publication after stop during replacement', async () => {
    await share()
    const next = track('video'),
      audio = track('audio'),
      publishing = deferred<undefined>()
    p.createScreenTracks.mockResolvedValueOnce([next, audio])
    const publish = p.publishTrack.getMockImplementation()!
    p.publishTrack.mockImplementationOnce(async (t, options) => {
      await publishing.promise
      return publish(t, options)
    })
    const update = v.setScreenAudio(true)
    await flush()
    await v.stopScreen()
    publishing.resolve()
    await update
    expect(next.stop).toHaveBeenCalled()
    expect(audio.stop).toHaveBeenCalled()
    expect(p.getTrackPublication('screen_share')).toBeUndefined()
    expect(p.publishTrack).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['stop', false],
    ['stop', true],
    ['leave', false],
    ['leave', true],
  ] as const)('stops accepted replacement capture immediately on %s before pending audio settles (reject=%s)', async (action, reject) => {
    const sdk = await vi.importActual<typeof import('livekit-client')>('livekit-client')
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(public tracks: MediaStreamTrack[]) {}
        getTracks() {
          return this.tracks
        }
      },
    )
    media.sdk = true
    const allocated: MediaStreamTrack[] = []
    const publish = p.publishTrack.getMockImplementation()!
    p.publishTrack.mockImplementation(async (t, options) => {
      if (t instanceof sdk.LocalVideoTrack) {
        const backup = t.addSimulcastTrack('vp8')!
        allocated.push(t.mediaStreamTrack, backup.mediaStreamTrack)
      }
      return publish(t, options)
    })
    const { video } = await share()
    const next = track('video'),
      audio = track('audio'),
      publishing = deferred<undefined>()
    p.createScreenTracks.mockResolvedValueOnce([next, audio])
    const publishWithBackup = p.publishTrack.getMockImplementation()!
    p.publishTrack.mockImplementation(async (t, options) => {
      if (t === audio) {
        await publishing.promise
        if (reject) throw new Error('late audio failure')
      }
      return publishWithBackup(t, options)
    })
    const update = v.setScreenAudio(true)
    await vi.waitFor(() => expect(p.publishTrack).toHaveBeenCalledWith(audio, SCREEN_AUDIO_PUBLISH))
    expect(p.getTrackPublication('screen_share')!.track!.mediaStreamTrack.readyState).toBe('live')
    expect(allocated).toHaveLength(4)
    if (action === 'stop') await v.stopScreen()
    else await v.leave(false)
    // These assertions must run while audio publication is still pending.
    for (const t of [video, next, audio]) expect(t.mediaStreamTrack.readyState).toBe('ended')
    expect(allocated.every(t => t.readyState === 'ended')).toBe(true)
    publishing.resolve()
    await update
    expect(p.getTrackPublication('screen_share')).toBeUndefined()
    expect(p.getTrackPublication('screen_share_audio')).toBeUndefined()
    expect(p.publishTrack).toHaveBeenCalledTimes(2) // no original-share restoration
    expect(v.screenOn.value).toBe(false)
    expect(settings.value.screenAudio).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it.each(['unpublish', 'video publish', 'audio publish'] as const)(
    'rejects replacement capture ending during %s and restores the live original',
    async boundary => {
      const { video } = await share()
      const next = track('video'),
        audio = track('audio'),
        wait = deferred<undefined>()
      p.createScreenTracks.mockResolvedValueOnce([next, audio])
      const unpublish = p.unpublishTrack.getMockImplementation()!,
        publish = p.publishTrack.getMockImplementation()!
      if (boundary === 'unpublish')
        p.unpublishTrack.mockImplementationOnce(async (t, stop) => {
          await wait.promise
          return unpublish(t, stop)
        })
      else
        p.publishTrack.mockImplementationOnce(async (t, options) => {
          if (boundary === 'video publish') await wait.promise
          return publish(t, options)
        })
      if (boundary === 'audio publish')
        p.publishTrack.mockImplementationOnce(async (t, options) => {
          await wait.promise
          return publish(t, options)
        })
      const update = v.setScreenAudio(true)
      await vi.waitFor(() => expect(boundary === 'unpublish' ? p.unpublishTrack : p.publishTrack).toHaveBeenCalledTimes(boundary === 'audio publish' ? 2 : 1))
      next.mediaStreamTrack.readyState = 'ended'
      next.mediaStreamTrack.dispatchEvent(new Event('ended'))
      wait.resolve()
      await update
      expect(video.stop).not.toHaveBeenCalled()
      expect(video.mediaStreamTrack.readyState).toBe('live')
      expect(p.getTrackPublication('screen_share')?.track?.mediaStreamTrack).toBe(video.mediaStreamTrack.clone.mock.results.at(-1)!.value)
      expect(p.getTrackPublication('screen_share')?.track?.mediaStreamTrack.readyState).toBe('live')
      expect(next.stop).toHaveBeenCalled()
      expect(audio.stop).toHaveBeenCalled()
      expect(settings.value.screenAudio).toBe(false)
      expect(v.screenOn.value).toBe(true)
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('replacement screen capture stopped') }))
    },
  )

  it('observes browser Stop immediately after replacement ownership transfers', async () => {
    await share()
    const next = track('video'),
      audio = track('audio')
    p.createScreenTracks.mockResolvedValueOnce([next, audio])
    await v.setScreenAudio(true)
    next.mediaStreamTrack.readyState = 'ended'
    next.mediaStreamTrack.dispatchEvent(new Event('ended'))
    await flush()
    expect(v.screenOn.value).toBe(false)
    expect(audio.stop).toHaveBeenCalled()
  })

  it.each(['stop', 'leave'] as const)('releases actual SDK backup clones across quality/replacement and %s, retaining only the owned source', async action => {
    const sdk = await vi.importActual<typeof import('livekit-client')>('livekit-client')
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(public tracks: MediaStreamTrack[]) {}
        getTracks() {
          return this.tracks
        }
      },
    )
    media.sdk = true
    const allocated: MediaStreamTrack[] = []
    const publish = p.publishTrack.getMockImplementation()!,
      unpublish = p.unpublishTrack.getMockImplementation()!
    p.publishTrack.mockImplementation(async (t, options) => {
      const pub = await publish(t, options)
      if (t instanceof sdk.LocalVideoTrack) {
        const backup = t.addSimulcastTrack('vp8')!
        allocated.push(t.mediaStreamTrack, backup.mediaStreamTrack)
        const sender = () => ({ replaceTrack: async () => {}, getParameters: () => ({}), setParameters: async () => {} }) as unknown as RTCRtpSender
        t.sender = sender()
        backup.sender = sender()
        Object.assign(pub, {
          kind: 'video',
          trackSid: t.source,
          setTrack: (value: TestTrack) => {
            pub.track = value
          },
        })
      }
      return pub
    })
    const sdkParticipant = {
      onTrackMuted() {},
      onTrackUnmuted() {},
      handleTrackEnded() {},
      onTrackUpstreamPaused() {},
      onTrackUpstreamResumed() {},
      onTrackFeatureUpdate() {},
      pendingPublishPromises: new Map(),
      getPublicationForTrack: (t: TestTrack) => [...p.trackPublications.values()].find(pub => pub.track === t),
      trackPublications: p.trackPublications,
      audioTrackPublications: p.audioTrackPublications,
      videoTrackPublications: p.videoTrackPublications,
      log: { info() {}, warn() {} },
      emit: () => r.emit('LocalTrackUnpublished'),
      engine: { pcManager: { currentState: 0, publisher: { getTransceivers: () => [] } }, removeTrack: () => true, negotiate: async () => {} },
    }
    p.unpublishTrack.mockImplementation(async (t, stop) => {
      if (t instanceof sdk.LocalVideoTrack) await sdk.LocalParticipant.prototype.unpublishTrack.call(sdkParticipant as unknown as LocalParticipant, t, stop)
      else await unpublish(t, stop)
    })
    const { video } = await share()
    const first = allocated.slice()
    await v.setScreenQuality(SMOOTH)
    expect(toast.mock.calls).toEqual([])
    expect(first.every(t => t.readyState === 'ended')).toBe(true)
    expect(video.mediaStreamTrack.readyState).toBe('live')
    const superseded = allocated.slice(),
      next = track('video'),
      audio = track('audio')
    p.createScreenTracks.mockResolvedValueOnce([next, audio])
    await v.setScreenAudio(true)
    expect(superseded.every(t => t.readyState === 'ended')).toBe(true)
    expect(video.mediaStreamTrack.readyState).toBe('ended')
    expect(next.mediaStreamTrack.readyState).toBe('live')
    if (action === 'stop') await v.stopScreen()
    else await v.leave(false)
    expect(allocated).toHaveLength(6)
    expect(allocated.every(t => t.readyState === 'ended')).toBe(true)
    expect(next.mediaStreamTrack.readyState).toBe('ended')
    expect(audio.mediaStreamTrack.readyState).toBe('ended')
    expect(v.tiles.value.every(t => t.screenQuality === undefined)).toBe(true)
  })

  it('reports mute failure and leaves the switch reflecting the outgoing audio', async () => {
    const { sound } = await share(true)
    sound!.mute.mockRejectedValueOnce(new Error('mute failed'))
    await v.setScreenAudio(false)
    expect(settings.value.screenAudio).toBe(true)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'mute failed' }))
  })

  it.each(['stop', 'leave'] as const)('discards late audio permission after %s without resurrecting a share', async action => {
    const { video } = await share()
    const wait = deferred<ReturnType<typeof track>[]>(),
      next = track('video'),
      audio = track('audio')
    p.createScreenTracks.mockReturnValueOnce(wait.promise)
    const update = v.setScreenAudio(true)
    if (action === 'stop') await v.stopScreen()
    else await v.leave(false)
    wait.resolve([next, audio])
    await update
    expect(video.stop).toHaveBeenCalled()
    expect(next.stop).toHaveBeenCalled()
    expect(audio.stop).toHaveBeenCalled()
    expect(p.publishTrack).not.toHaveBeenCalled()
    expect(v.screenOn.value).toBe(false)
  })

  it('discards initial capture if sharing is stopped while the initial picker is pending', async () => {
    const wait = deferred<ReturnType<typeof track>[]>(),
      video = track('video')
    p.createScreenTracks.mockReturnValueOnce(wait.promise)
    const start = v.startScreen()
    await v.stopScreen()
    wait.resolve([video])
    await start
    expect(video.stop).toHaveBeenCalled()
    expect(p.publishTrack).not.toHaveBeenCalled()
  })
})

describe('screen controls', () => {
  it('toggleScreen opens the dialog when idle and stops when sharing', async () => {
    v.toggleScreen()
    expect(v.screenDialog.value).toBe(true)
    expect(p.createScreenTracks).not.toHaveBeenCalled()
    v.screenDialog.value = false
    const { video } = await share()
    v.toggleScreen()
    await flush()
    expect(v.screenDialog.value).toBe(false)
    expect(video.stop).toHaveBeenCalled()
  })
})
