import type { Ref } from 'vue'

import type { VoiceSettings } from '~/composables/useVoiceSettings'

import { EventEmitter } from 'node:events'

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
  resumeProcessor: vi.fn(async () => {}),
  destroyProcessor: vi.fn(async () => {}),
  processorState: vi.fn<(blocked: boolean) => void>(),
  prepareProcessor: vi.fn(async () => {}),
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
    restartTrack = vi.fn(async () => {})
    mic = {
      stopOnMute: false,
      isMuted: false,
      restartTrack: this.restartTrack,
      applyConstraints: vi.fn(async () => {}),
      setProcessor: vi.fn(() => mocks.prepareProcessor()),
      mute: vi.fn(async () => {
        this.mic.isMuted = true
      }),
      unmute: vi.fn(async () => {
        this.mic.isMuted = false
      }),
      stop: vi.fn(),
    }
    localParticipant = {
      audioTrackPublications: new Map(),
      connectionQuality: 'excellent',
      identity: 'local',
      isLocal: true,
      trackPublications: new Map(),
      getTrackPublication: () => ({ audioTrack: this.mic }),
      createTracks: vi.fn(async () => [this.mic]),
      publishTrack: vi.fn(async () => {}),
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.events.set(event, [...(this.events.get(event) ?? []), fn])
      return this
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.events.get(event) ?? []) fn(...args)
    }
    connect = vi.fn(async () => {
      media.connect?.()
    })
    startAudio = vi.fn(async () => {
      for (const p of this.remoteParticipants.values())
        for (const pub of p.audioTrackPublications.values()) for (const element of pub.track?.attachedElements ?? []) element.muted = false
    })
    disconnect = vi.fn(async () => {})
    switchActiveDevice = vi.fn(async () => {})
    getActiveDevice = vi.fn(() => 'default')
    constructor(public options: { audioOutput?: unknown }) {
      media.rooms.push(this)
    }
  }
  const media = { rooms: [] as MockRoom[], connect: undefined as undefined | (() => void) }
  return { media, MockRoom }
})
vi.mock('~/utils/voice-processor', () => ({
  MicProcessor: class {
    constructor(_cfg: unknown, onAudioBlocked: (blocked: boolean) => void) {
      mocks.processorState.mockImplementation(onAudioBlocked)
    }
    resume = mocks.resumeProcessor
    destroy = mocks.destroyProcessor
    update() {}
  },
}))
vi.mock('livekit-client', () => ({
  Track: { Kind: { Audio: 'audio' } },
  RoomEvent: {
    TrackSubscribed: 'subscribed',
    TrackUnsubscribed: 'unsubscribed',
    Disconnected: 'disconnected',
    ActiveDeviceChanged: 'activeDeviceChanged',
    SignalReconnecting: 'signalReconnecting',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    AudioPlaybackStatusChanged: 'audioPlaybackChanged',
    ParticipantDisconnected: 'participantDisconnected',
    TrackUnpublished: 'trackUnpublished',
    TrackPublished: 'trackPublished',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ParticipantConnected: 'participantConnected',
    ActiveSpeakersChanged: 'speakers',
  },
  Room: MockRoom,
  DisconnectReason: { UNKNOWN_REASON: 0, SIGNAL_CLOSE: 9, STATE_MISMATCH: 6, CONNECTION_TIMEOUT: 14, SERVER_SHUTDOWN: 3, MEDIA_FAILURE: 15 },
}))

const device = (deviceId: string) => ({ deviceId, label: deviceId, kind: 'audiooutput' })
const mic = (deviceId: string, label = deviceId) => ({ deviceId, label, kind: 'audioinput' })
const toast = vi.fn()
let settings: Ref<Partial<VoiceSettings>>
let available: Array<{ deviceId: string; label: string; kind: string }>
let deviceChange: () => Promise<void>
let voice: ReturnType<typeof import('~/composables/useVoice').useVoice>

function track(source: string) {
  const element = document.createElement('audio')
  return Object.assign(new EventEmitter(), {
    source,
    kind: 'audio',
    mediaStreamTrack: { enabled: true },
    isMuted: false,
    attachedElements: [element],
    attach: vi.fn(() => element),
    detach: () => [element],
    setSinkId: vi.fn(async (_id: string) => {}),
    // Deliberately ignore volume writes, as on iOS: silence must come from the native track.
    setVolume: vi.fn(),
  })
}
function participant(id: string, tracks: ReturnType<typeof track>[]) {
  const pubs = new Map(tracks.map((t, i) => [i, { source: t.source, track: t, audioTrack: t, isDesired: true, setSubscribed: vi.fn() }]))
  return { identity: id, audioTrackPublications: pubs, trackPublications: pubs, videoTrackPublications: new Map(), getTrackPublication: () => undefined }
}
async function setup(supported = true) {
  if (supported) Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: vi.fn() })
  else Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId')
  const mod = await import('~/composables/useVoice')
  mod.useVoiceLive()
  voice = mod.useVoice()
  await voice.join('channel')
  await vi.waitFor(() => expect(voice.microphone.value).toBe('ready'))
  expect(voice.channelId.value).toBe('channel')
  return media.rooms[0]!
}

beforeEach(() => {
  vi.resetModules()
  media.rooms = []
  media.connect = undefined
  toast.mockClear()
  mocks.resumeProcessor.mockReset().mockResolvedValue()
  mocks.destroyProcessor.mockReset().mockResolvedValue()
  mocks.prepareProcessor.mockReset().mockResolvedValue()
  mocks.processorState.mockReset()
  available = [device('voice'), device('screen'), device('other')]
  settings = ref({ speaker: device('voice'), mediaSpeaker: device('screen'), noise: 'standard', sensitivity: 50, outputVolume: 0.8 })
  mocks.useLocalStorage.mockImplementation((_: string, value: unknown) => ref(value))
  mocks.useVoiceSettings.mockImplementation(() => settings)
  mocks.useToast.mockImplementation(() => ({ add: toast }))
  mocks.useMe.mockImplementation(() => ({ data: ref({ id: 'local' }) }))
  mocks.useSounds.mockImplementation(() => ({ data: ref([]) }))
  mocks.useEventListener.mockImplementation((_target: unknown, event: string, fn: () => Promise<void>) => {
    if (event === 'devicechange') deviceChange = fn
  })
  mocks.useWakeLock.mockImplementation(() => ({ request: async () => {}, release: async () => {} }))
  vi.stubGlobal(
    '$fetch',
    vi.fn(async () => ({ token: 'token', url: 'url' })),
  )
  const handlers = new Set<(m: Record<string, unknown>) => void>()
  mocks.useSocket.mockImplementation(() => ({
    connected: ref(true),
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
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
      enumerateDevices: async () => available,
    },
  })
})
afterEach(async () => {
  await voice?.leave(false)
  document.body.replaceChildren()
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId')
  vi.unstubAllGlobals()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('microphone lifecycle', () => {
  it('enumerates without capture and skips permission capture when labels are already known', async () => {
    available.push(mic('mac', 'MacBook'))
    settings.value.mic = { deviceId: 'mac', label: 'MacBook' }
    const capture = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
    const mod = await import('~/composables/useVoice')
    voice = mod.useVoice()
    await voice.refreshDevices()
    expect(capture).not.toHaveBeenCalled()
    await voice.join('channel')
    await vi.waitFor(() => expect(voice.microphone.value).toBe('ready'))
    expect(capture).not.toHaveBeenCalled()
    expect(media.rooms[0]!.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'mac', false)
    expect(media.rooms[0]!.localParticipant.createTracks).toHaveBeenCalledWith({ audio: expect.objectContaining({ deviceId: 'mac' }) })
  })

  it('targets the saved input for permission and releases the temporary stream', async () => {
    settings.value.mic = { deviceId: 'mac', label: 'MacBook' }
    const stop = vi.fn()
    const capture = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await setup()
    expect(capture).toHaveBeenCalledExactlyOnceWith({ audio: { deviceId: 'mac' } })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('stores settings without restarting capture while muted and reports unmute failure', async () => {
    const r = await setup()
    voice.toggleMic()
    await Promise.resolve()
    await voice.applySettings()
    expect(r.mic.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({ noiseSuppression: true }))
    expect(r.restartTrack).not.toHaveBeenCalled()
    r.mic.unmute.mockRejectedValueOnce(new Error('Microphone unavailable'))
    voice.toggleMic()
    await Promise.resolve()
    await Promise.resolve()
    expect(voice.mute.value.muted).toBe(true)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not change microphone state' }))
  })
})

describe('independent remote audio outputs', () => {
  it('reroutes screen audio when the media device ID changes but its label still matches', async () => {
    const r = await setup()
    const screen = track('screen_share_audio')
    r.remoteParticipants.set('one', participant('one', [screen]))
    available = [device('voice'), { ...device('replacement'), label: 'screen' }]
    await deviceChange()
    expect(screen.setSinkId).toHaveBeenLastCalledWith('replacement')
    expect(settings.value.mediaSpeaker!.deviceId).toBe('screen')
    expect(toast).not.toHaveBeenCalled()
  })

  it('restores the latest media preference when an older screen-audio switch finishes last', async () => {
    const r = await setup()
    const screen = track('screen_share_audio')
    r.remoteParticipants.set('one', participant('one', [screen]))
    let finish!: () => void
    screen.setSinkId.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const old = voice.pickDevice('mediaSpeaker', device('other'))
    await voice.pickDevice('mediaSpeaker', device('voice'))
    finish()
    await old
    expect(screen.setSinkId).toHaveBeenLastCalledWith('voice')
    expect(settings.value.mediaSpeaker!.deviceId).toBe('voice')
  })

  it('reports media unplug/replug outside calls without reporting the unused voice output', async () => {
    await setup()
    await voice.leave(false)
    available = [device('other')]
    await deviceChange()
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Your media output was unplugged' }))
    expect(settings.value.mediaSpeaker!.deviceId).toBe('screen')
    available.push(device('screen'))
    await deviceChange()
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'Your media output is back.' }))
  })

  it.each([true, false])('defaults screen audio independently for a saved voice preference: %s', async savedVoice => {
    settings.value.mediaSpeaker = undefined
    if (!savedVoice) settings.value.speaker = undefined
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    media.connect = () => {
      const r = media.rooms.at(-1)!
      r.emit('subscribed', mic, { source: mic.source, track: mic }, { identity: 'one' })
      r.emit('subscribed', screen, { source: screen.source, track: screen }, { identity: 'one' })
    }
    await setup()
    expect(mic.setSinkId).toHaveBeenLastCalledWith(savedVoice ? 'voice' : '')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('')
    expect(settings.value.speaker?.deviceId).toBe(savedVoice ? 'voice' : undefined)
    expect(settings.value.mediaSpeaker).toBeUndefined()
  })

  it('routes subscriptions before room assignment, later subscriptions and rejoins using saved preferences', async () => {
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    media.connect = () => {
      const r = media.rooms.at(-1)!
      expect(voice.activeRoom()).toBeUndefined()
      r.emit('subscribed', mic, { source: mic.source, track: mic }, { identity: 'one' })
      r.emit('subscribed', screen, { source: screen.source, track: screen }, { identity: 'one' })
    }
    const r = await setup()
    expect(r.options.audioOutput).toBeUndefined()
    expect(mic.setSinkId).toHaveBeenLastCalledWith('voice')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('screen')
    const later = track('screen_share_audio')
    r.emit('subscribed', later, { source: later.source, track: later }, { identity: 'one' })
    expect(later.setSinkId).toHaveBeenLastCalledWith('screen')
    r.emit('unsubscribed', later)
    expect(document.body.contains(later.attach())).toBe(false)
    r.emit('subscribed', later, { source: later.source, track: later }, { identity: 'one' })
    expect(later.setSinkId).toHaveBeenCalledTimes(2)
    await voice.leave(false)
    settings.value.mediaSpeaker = undefined
    await voice.join('channel')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('')
    expect(settings.value.speaker!.deviceId).toBe('voice')
  })

  it('switches only the selected category across participants, including explicit system default, without changing volumes', async () => {
    const r = await setup()
    const mic = track('microphone'),
      screen = track('screen_share_audio'),
      otherScreen = track('screen_share_audio')
    r.remoteParticipants.set('one', participant('one', [mic, screen]))
    r.remoteParticipants.set('two', participant('two', [otherScreen]))
    await voice.pickDevice('mediaSpeaker', device('other'))
    expect(mic.setSinkId).not.toHaveBeenCalled()
    expect(screen.setSinkId).toHaveBeenLastCalledWith('other')
    expect(otherScreen.setSinkId).toHaveBeenLastCalledWith('other')
    await voice.pickDevice('speaker', device('default'))
    expect(settings.value.speaker).toBeUndefined()
    expect(settings.value.mediaSpeaker!.deviceId).toBe('other')
    expect(mic.setSinkId).toHaveBeenLastCalledWith('')
    expect(screen.setSinkId).toHaveBeenCalledTimes(1)
    await voice.pickDevice('mediaSpeaker', device('default'))
    expect(screen.setSinkId).toHaveBeenLastCalledWith('')
    voice.setVolume('one', { mic: 0.5, screen: 0.25 })
    expect(mic.setVolume).toHaveBeenLastCalledWith(0.4)
    expect(screen.setVolume).toHaveBeenLastCalledWith(0.2)
    voice.toggleHeadphones()
    expect(mic.setVolume).toHaveBeenLastCalledWith(0)
    expect(screen.setVolume).toHaveBeenLastCalledWith(0)
    voice.toggleHeadphones()
    voice.setVolume('one', { muted: true })
    expect(mic.setVolume).toHaveBeenLastCalledWith(0)
    expect(screen.setVolume).toHaveBeenLastCalledWith(0)
    expect(r.switchActiveDevice).not.toHaveBeenCalled()
  })

  it('keeps unsupported playback on default without sink calls', async () => {
    const r = await setup(false)
    const screen = track('screen_share_audio')
    r.remoteParticipants.set('one', participant('one', [screen]))
    r.emit('subscribed', screen, { source: screen.source, track: screen }, { identity: 'one' })
    await voice.pickDevice('mediaSpeaker', device('other'))
    expect(voice.canPickOutput).toBe(false)
    expect(screen.setSinkId).not.toHaveBeenCalled()
    expect(document.body.contains(screen.attach())).toBe(true)
  })

  it('shows subscription and live-switch failures without rejecting', async () => {
    const r = await setup()
    const screen = track('screen_share_audio')
    screen.setSinkId.mockRejectedValue(new Error('Denied'))
    r.remoteParticipants.set('one', participant('one', [screen]))
    r.emit('subscribed', screen, { source: screen.source, track: screen }, { identity: 'one' })
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not switch device', description: 'Denied' })))
    toast.mockClear()
    await voice.pickDevice('mediaSpeaker', device('other'))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Denied' }))
  })

  it('falls back on unplug keeping the preference, and routes back on replug', async () => {
    const r = await setup()
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    r.remoteParticipants.set('one', participant('one', [mic, screen]))
    available = [device('screen'), device('other')]
    await deviceChange()
    expect(mic.setSinkId).toHaveBeenLastCalledWith('')
    expect(screen.setSinkId).not.toHaveBeenCalled()
    expect(settings.value.speaker!.deviceId).toBe('voice')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Your voice output was unplugged' }))
    await deviceChange()
    expect(toast).toHaveBeenCalledTimes(1)
    available = [device('voice'), device('screen'), device('other')]
    await deviceChange()
    expect(mic.setSinkId).toHaveBeenLastCalledWith('voice')
    expect(screen.setSinkId).not.toHaveBeenCalled()
    expect(settings.value.speaker!.deviceId).toBe('voice')
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Switched back to voice', color: 'info' }))
    expect(r.switchActiveDevice).not.toHaveBeenCalled()
  })

  it('restores per-category sinks after LiveKit switches the output itself', async () => {
    const r = await setup()
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    r.remoteParticipants.set('one', participant('one', [mic, screen]))
    r.emit('activeDeviceChanged', 'audioinput', 'x')
    expect(mic.setSinkId).not.toHaveBeenCalled()
    r.emit('activeDeviceChanged', 'audiooutput', 'other')
    expect(mic.setSinkId).toHaveBeenLastCalledWith('voice')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('screen')
  })

  it('falls back both categories sharing the missing device', async () => {
    const r = await setup()
    settings.value.mediaSpeaker = device('voice')
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    r.remoteParticipants.set('one', participant('one', [mic, screen]))
    available = [device('other')]
    await deviceChange()
    expect(mic.setSinkId).toHaveBeenLastCalledWith('')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('')
    expect(toast).toHaveBeenCalledTimes(2)
  })
})

describe('remote audio silence gate', () => {
  it('combines 200% user/output gains, preserves separate sinks, and gates boosted audio across unmute and retry', async () => {
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
    const close = vi.fn(async () => {})
    const contexts: Array<{ state: string; onstatechange: (() => void) | null }> = []
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running'
        onstatechange: (() => void) | null = null
        constructor() {
          contexts.push(this)
        }
        resume = vi.fn(async () => {
          this.state = 'running'
          this.onstatechange?.()
        })
        close = close
        createMediaStreamSource = () => ({ connect: (gain: object) => gain, disconnect: vi.fn() })
        createGain = () => {
          const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
          gains.push(gain)
          return gain
        }
        createMediaStreamDestination = () => ({ stream: Object.assign(new MediaStream(), { getTracks: () => [] }) })
      },
    )
    const r = await setup()
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    const p = participant('one', [mic, screen])
    r.remoteParticipants.set('one', p)
    settings.value.outputVolume = 2
    voice.setVolume('one', { mic: 2, screen: 2 })
    for (const pub of p.audioTrackPublications.values()) r.emit('subscribed', pub.track, pub, p)
    expect(gains.map(gain => gain.gain.value)).toEqual([4, 4])
    expect(mic.setSinkId).toHaveBeenLastCalledWith('voice')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('screen')
    const context = contexts[0]!
    context.state = 'suspended'
    context.onstatechange!()
    expect(voice.audioBlocked.value).toBe(true)
    expect(r.canPlaybackAudio).toBe(true)
    voice.setVolume('one', { mic: 0.25, screen: 0.25 })
    expect(gains.map(gain => gain.gain.value)).toEqual([0.5, 0.5])
    r.emit('audioPlaybackStatusChanged', true)
    expect(voice.audioBlocked.value).toBe(true)
    await voice.enableAudio()
    expect(context.state).toBe('running')
    expect(voice.audioBlocked.value).toBe(false)
    voice.setVolume('one', { mic: 2, screen: 2 })
    voice.toggleHeadphones()
    mic.mediaStreamTrack.enabled = true
    mic.emit('unmuted', mic)
    await voice.enableAudio()
    expect(mic.mediaStreamTrack.enabled).toBe(false)
    expect(gains.map(gain => gain.gain.value)).toEqual([0, 0])
    voice.toggleHeadphones()
    expect(gains.map(gain => gain.gain.value)).toEqual([4, 4])
    await voice.leave(false)
    expect(close).toHaveBeenCalledOnce()
    expect(gains.every(gain => gain.disconnect.mock.calls.length === 1)).toBe(true)
  })

  it.each([
    { name: 'deafen', deafened: true, saved: { mic: 0.5, screen: 0.25 }, expected: [0, 0] },
    { name: 'mute for me', deafened: false, saved: { muted: true }, expected: [0, 0] },
    { name: 'independent saved volumes', deafened: false, saved: { mic: 0.5, screen: 0.25 }, expected: [0.4, 0.2] },
    { name: 'zero mic volume', deafened: false, saved: { mic: 0, screen: 0.25 }, expected: [0, 0.2] },
  ])('applies $name before attachment during a pending join', async ({ deafened, saved, expected }) => {
    const mod = await import('~/composables/useVoice')
    voice = mod.useVoice()
    voice.setVolume('one', saved)
    if (deafened) voice.toggleHeadphones()
    const tracks = [track('microphone'), track('screen_share_audio')]
    media.connect = () => {
      const r = media.rooms.at(-1)!
      const p = participant('one', tracks)
      r.remoteParticipants.set('one', p)
      expect(voice.activeRoom()).toBeUndefined()
      for (const [i, pub] of p.audioTrackPublications) {
        const t = pub.track
        const element = t.attachedElements[0]!
        t.attach.mockImplementation(() => {
          expect(t.mediaStreamTrack.enabled).toBe(expected[i]! > 0)
          expect(t.setVolume).toHaveBeenLastCalledWith(expected[i])
          return element
        })
        r.emit('subscribed', t, pub, p)
        expect(t.attach).toHaveBeenCalledOnce()
      }
    }
    await voice.join('channel')
    expect(voice.channelId.value).toBe('channel')
    expect(voice.mute.value.deafened).toBe(deafened)
    expect(voice.volumes.value.one).toEqual(saved)
  })

  it.each(['microphone', 'screen_share_audio'])('gates %s after remote unmute and replacement subscription while deafened', async source => {
    const r = await setup()
    const original = track(source)
    const p = participant('one', [original])
    r.remoteParticipants.set('one', p)
    voice.watch('one', true)
    expect(original.mediaStreamTrack.enabled).toBe(true)
    voice.toggleHeadphones()
    expect(original.mediaStreamTrack.enabled).toBe(false)
    const pub = p.audioTrackPublications.get(0)!
    original.isMuted = true
    original.mediaStreamTrack.enabled = false
    r.emit('trackMuted', pub, p)
    // LiveKit reenables the native track before forwarding the unmute event.
    original.isMuted = false
    original.mediaStreamTrack.enabled = true
    r.emit('trackUnmuted', pub, p)
    expect(original.mediaStreamTrack.enabled).toBe(false)
    expect(voice.mute.value.deafened).toBe(true)

    const replacement = track(source)
    const element = replacement.attachedElements[0]!
    replacement.attach.mockImplementation(() => {
      expect(replacement.mediaStreamTrack.enabled).toBe(false)
      return element
    })
    pub.track = pub.audioTrack = replacement
    r.emit('subscribed', replacement, pub, p)
    r.emit('subscribed', replacement, pub, p)
    expect(replacement.attach).toHaveBeenCalledOnce()
    expect(replacement.mediaStreamTrack.enabled).toBe(false)
    expect(element.volume).toBe(1)
    expect(voice.mute.value.deafened).toBe(true)
  })

  it.each(['microphone', 'screen_share_audio'])('synchronously re-gates retained %s during signaling recovery and cleans up listeners', async source => {
    const r = await setup()
    const t = track(source)
    const p = participant('one', [t])
    const pub = p.audioTrackPublications.get(0)!
    r.remoteParticipants.set('one', p)
    voice.watch('one', true)
    r.emit('subscribed', t, pub, p)
    voice.toggleHeadphones()
    r.emit('signalReconnecting')
    r.emit('subscribed', t, pub, p)
    voice.applyOutput()
    expect(t.listenerCount('unmuted')).toBe(1)
    expect(t.attach).toHaveBeenCalledOnce()
    expect(t.attachedElements[0]!.isConnected).toBe(true)
    const roomUnmuted = vi.fn()
    r.on('trackUnmuted', roomUnmuted)
    t.isMuted = true
    t.mediaStreamTrack.enabled = false
    r.emit('trackMuted', pub, p)
    t.setVolume.mockClear()
    // SDK native reenabling and track notification happen now; the room notification is withheld until recovery.
    t.isMuted = false
    t.mediaStreamTrack.enabled = true
    t.emit('unmuted', t)
    expect(t.mediaStreamTrack.enabled).toBe(false)
    expect(t.setVolume).toHaveBeenCalledExactlyOnceWith(0)
    expect(t.attachedElements[0]!.volume).toBe(1)
    expect(t.attachedElements[0]!.isConnected).toBe(true)
    expect(roomUnmuted).not.toHaveBeenCalled()
    expect(voice.connection.value).toBe('signalReconnecting')
    expect(voice.mute.value.deafened).toBe(true)
    r.emit('reconnected')
    r.emit('trackUnmuted', pub, p)
    expect(t.listenerCount('unmuted')).toBe(1)
    expect(t.mediaStreamTrack.enabled).toBe(false)
    // LiveKit emits unsubscribe while the publication still points to the old track.
    r.emit('unsubscribed', t, pub, p)
    expect(t.listenerCount('unmuted')).toBe(0)
    Reflect.deleteProperty(pub, 'track')
    Reflect.deleteProperty(pub, 'audioTrack')
    await Promise.resolve()
    expect(t.listenerCount('unmuted')).toBe(0)
    expect(t.attachedElements[0]!.isConnected).toBe(false)
    pub.track = pub.audioTrack = t
    r.emit('subscribed', t, pub, p)
    expect(t.listenerCount('unmuted')).toBe(1)
    voice.toggleHeadphones()
    expect(t.mediaStreamTrack.enabled).toBe(true)
    await voice.leave(false)
    expect(t.listenerCount('unmuted')).toBe(0)
    expect(t.attachedElements[0]!.isConnected).toBe(false)
    t.setVolume.mockClear()
    t.emit('unmuted', t)
    expect(t.setVolume).not.toHaveBeenCalled()
  })

  it.each(['microphone', 'screen_share_audio'])('does not retain obsolete %s listeners through subscription churn', async source => {
    const r = await setup()
    const first = track(source)
    const p = participant('one', [first])
    const pub = p.audioTrackPublications.get(0)!
    const retired = [] as ReturnType<typeof track>[]
    r.remoteParticipants.set('one', p)
    voice.watch('one', true)
    voice.toggleHeadphones()
    r.emit('subscribed', first, pub, p)

    for (const mode of ['unsubscribe', 'replacement', 'unpublish', 'replacement'] as const) {
      const old = pub.track
      retired.push(old)
      // RemoteTrackPublication.setTrack emits before clearing/replacing track; unpublish removes maps afterward too.
      r.emit('unsubscribed', old, pub, p)
      expect(old.listenerCount('unmuted')).toBe(0)
      expect(old.attachedElements[0]!.isConnected).toBe(false)
      Reflect.deleteProperty(pub, 'track')
      Reflect.deleteProperty(pub, 'audioTrack')
      if (mode === 'unpublish') {
        p.audioTrackPublications.delete(0)
        r.emit('trackUnpublished', pub, p)
      }
      const next = track(source)
      const element = next.attachedElements[0]!
      next.attach.mockImplementation(() => {
        expect(next.mediaStreamTrack.enabled).toBe(false)
        return element
      })
      if (mode !== 'replacement') {
        await Promise.resolve()
        voice.applyOutput()
        for (const t of retired) expect(t.listenerCount('unmuted')).toBe(0)
      }
      pub.track = pub.audioTrack = next
      p.audioTrackPublications.set(0, pub)
      r.emit('subscribed', next, pub, p)
      await Promise.resolve()
      voice.applyOutput()
      for (const t of retired) {
        expect(t.listenerCount('unmuted')).toBe(0)
        t.setVolume.mockClear()
        t.emit('unmuted', t)
        expect(t.setVolume).not.toHaveBeenCalled()
      }
      expect(next.listenerCount('unmuted')).toBe(1)
      expect(next.attach).toHaveBeenCalledOnce()
      expect(next.mediaStreamTrack.enabled).toBe(false)
    }

    // A queued old-room rebuild must not register listeners after leave or in a new session.
    const last = pub.track
    r.emit('unsubscribed', last, pub, p)
    await voice.leave(false)
    await voice.join('other-channel')
    r.emit('unsubscribed', last, pub, p)
    await Promise.resolve()
    voice.applyOutput()
    for (const t of [...retired, last]) expect(t.listenerCount('unmuted')).toBe(0)
  })

  it.each([
    ['microphone', 'removed'],
    ['microphone', 'replaced'],
    ['screen_share_audio', 'removed'],
    ['screen_share_audio', 'replaced'],
  ])('ignores buffered obsolete %s subscriptions when %s during recovery', async (source, mode) => {
    const r = await setup()
    const retired = track(source)
    const p = participant('one', [retired])
    const pub = p.audioTrackPublications.get(0)!
    r.remoteParticipants.set('one', p)
    voice.watch('one', true)
    voice.toggleHeadphones()
    r.emit('signalReconnecting')
    // LiveKit buffers subscription with the mutable publication, but forwards unsubscribe immediately.
    const replay = () => r.emit('subscribed', retired, pub, p)
    r.emit('unsubscribed', retired, pub, p)
    expect(retired.listenerCount('unmuted')).toBe(0)
    Reflect.deleteProperty(pub, 'track')
    Reflect.deleteProperty(pub, 'audioTrack')
    const replacement = track(source)
    if (mode === 'removed') {
      p.audioTrackPublications.delete(0)
    } else {
      pub.track = pub.audioTrack = replacement
      const element = replacement.attachedElements[0]!
      replacement.attach.mockImplementation(() => {
        expect(replacement.mediaStreamTrack.enabled).toBe(false)
        return element
      })
    }
    await Promise.resolve()
    retired.setVolume.mockClear()
    expect(retired.listenerCount('unmuted')).toBe(0)
    // Reconnected is emitted before the SDK flushes buffered subscription events.
    r.emit('reconnected')
    replay()
    replay()
    if (mode === 'replaced') {
      r.emit('subscribed', replacement, pub, p)
      r.emit('subscribed', replacement, pub, p)
      expect(replacement.listenerCount('unmuted')).toBe(1)
      expect(replacement.attach).toHaveBeenCalledOnce()
      expect(replacement.mediaStreamTrack.enabled).toBe(false)
    }
    await Promise.resolve()
    expect(retired.listenerCount('unmuted')).toBe(0)
    expect(retired.attach).not.toHaveBeenCalled()
    expect(retired.setSinkId).not.toHaveBeenCalled()
    expect(retired.attachedElements[0]!.isConnected).toBe(false)
    retired.emit('unmuted', retired)
    expect(retired.setVolume).not.toHaveBeenCalled()
    expect(voice.mute.value.deafened).toBe(true)
  })

  it.each(['fails', 'is cancelled'])('removes pending-join output listeners when connection %s', async outcome => {
    const t = track('microphone')
    media.connect = () => {
      const r = media.rooms.at(-1)!
      r.emit('subscribed', t, { source: t.source, track: t }, { identity: 'one' })
      expect(t.listenerCount('unmuted')).toBe(1)
      if (outcome === 'fails') throw new Error('Connection failed')
      void voice.leave(false)
      expect(t.listenerCount('unmuted')).toBe(0)
    }
    const mod = await import('~/composables/useVoice')
    voice = mod.useVoice()
    await voice.join('channel')
    expect(voice.channelId.value).toBeNull()
    expect(t.listenerCount('unmuted')).toBe(0)
  })

  it.each([false, true])('restores allowed mic/screen output and the prior local mute state (%s)', async initiallyMuted => {
    const r = await setup()
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    const remoteMuted = track('microphone'),
      userMuted = track('microphone'),
      zero = track('screen_share_audio')
    remoteMuted.isMuted = true
    r.remoteParticipants.set('one', participant('one', [mic, screen]))
    r.remoteParticipants.set('remote-muted', participant('remote-muted', [remoteMuted]))
    r.remoteParticipants.set('user-muted', participant('user-muted', [userMuted]))
    r.remoteParticipants.set('zero', participant('zero', [zero]))
    voice.watch('one', true)
    voice.setVolume('one', { mic: 0.5, screen: 0.25 })
    voice.setVolume('user-muted', { muted: true })
    voice.setVolume('zero', { screen: 0 })
    const saved = { ...voice.volumes.value }
    if (initiallyMuted) voice.toggleMic()
    voice.toggleHeadphones()
    for (const t of [mic, screen, remoteMuted, userMuted, zero]) expect(t.mediaStreamTrack.enabled).toBe(false)
    expect(r.mic.isMuted).toBe(true)
    voice.toggleHeadphones()
    expect(mic.mediaStreamTrack.enabled).toBe(true)
    expect(screen.mediaStreamTrack.enabled).toBe(true)
    expect(mic.setVolume).toHaveBeenLastCalledWith(0.4)
    expect(screen.setVolume).toHaveBeenLastCalledWith(0.2)
    for (const t of [remoteMuted, userMuted, zero]) expect(t.mediaStreamTrack.enabled).toBe(false)
    expect(r.mic.isMuted).toBe(initiallyMuted)
    expect(voice.volumes.value).toEqual(saved)
    expect(settings.value.outputVolume).toBe(0.8)
    settings.value.outputVolume = 0
    voice.applyOutput()
    expect(mic.mediaStreamTrack.enabled).toBe(false)
    expect(screen.mediaStreamTrack.enabled).toBe(false)
    settings.value.outputVolume = 0.8
    voice.applyOutput()
    expect(mic.mediaStreamTrack.enabled).toBe(true)
    expect(screen.mediaStreamTrack.enabled).toBe(true)
  })

  it('keeps native audio silent when playback retry unmutes the HTML elements', async () => {
    const r = await setup()
    const tracks = [track('microphone'), track('screen_share_audio')]
    const p = participant('one', tracks)
    r.remoteParticipants.set('one', p)
    voice.watch('one', true)
    voice.toggleHeadphones()
    for (const pub of p.audioTrackPublications.values()) {
      r.emit('subscribed', pub.track, pub, p)
      pub.track.attachedElements[0]!.muted = true
    }
    await voice.enableAudio()
    for (const t of tracks) {
      expect(t.attachedElements[0]!.muted).toBe(false)
      expect(t.attachedElements[0]!.volume).toBe(1)
      expect(t.mediaStreamTrack.enabled).toBe(false)
    }
    expect(voice.mute.value.deafened).toBe(true)
    expect(voice.audioBlocked.value).toBe(false)
  })
})

describe('audio recovery', () => {
  it('restores subscriptions, attachments, independent outputs and deafen without duplicate elements', async () => {
    const r = await setup()
    let mic = track('microphone')
    let screen = track('screen_share_audio')
    let p = { ...participant('one', [mic, screen]), getTrackPublication: (source: string) => (source === 'screen_share' ? { isMuted: false } : undefined) }
    r.remoteParticipants.set('one', p)
    voice.watch('one', true)
    voice.toggleHeadphones()
    r.emit('subscribed', mic, p.audioTrackPublications.get(0), p)
    r.emit('subscribed', mic, p.audioTrackPublications.get(0), p)
    expect(document.querySelectorAll('audio')).toHaveLength(1)
    // Full restart removes participants before emitting Reconnecting.
    r.remoteParticipants.delete('one')
    r.emit('participantDisconnected')
    r.emit('reconnecting')
    await Promise.resolve()
    expect(voice.watching.value).toEqual(['one'])
    expect(voice.theater.value).toBe('one')
    r.emit('unsubscribed', mic)
    mic = track('microphone')
    screen = track('screen_share_audio')
    p = { ...participant('one', [mic, screen]), getTrackPublication: p.getTrackPublication }
    let routed!: () => void
    const routing = new Promise<void>(resolve => {
      routed = resolve
    })
    for (const t of [mic, screen]) {
      const element = t.attachedElements[0]!
      t.attach.mockImplementation(() => {
        expect(t.mediaStreamTrack.enabled).toBe(false)
        return element
      })
      t.setSinkId.mockImplementation(() => routing)
    }
    r.remoteParticipants.set('one', p)
    p.trackPublications.get(0)!.isDesired = false
    r.emit('reconnected')
    expect(mic.mediaStreamTrack.enabled).toBe(false)
    expect(screen.mediaStreamTrack.enabled).toBe(false)
    routed()
    await routing
    expect(p.trackPublications.get(0)!.setSubscribed).toHaveBeenCalledWith(true)
    expect(mic.setSinkId).toHaveBeenLastCalledWith('voice')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('screen')
    expect(mic.setVolume).toHaveBeenLastCalledWith(0)
    expect(screen.setVolume).toHaveBeenLastCalledWith(0)
    expect(voice.watching.value).toEqual(['one'])
    expect(voice.theater.value).toBe('one')
    expect(document.querySelectorAll('audio')).toHaveLength(2)
    r.emit('reconnected')
    expect(document.querySelectorAll('audio')).toHaveLength(2)
    await voice.leave(false)
    expect(document.querySelectorAll('audio')).toHaveLength(0)
  })

  it('keeps an element playback failure visible after a delayed context-only success', async () => {
    const r = await setup()
    r.startAudio.mockRejectedValueOnce(new Error('Gesture required'))
    await voice.enableAudio()
    r.canPlaybackAudio = true
    r.emit('audioPlaybackChanged')
    expect(voice.audioBlocked.value).toBe(true)
    r.emit('reconnected')
    expect(voice.audioBlocked.value).toBe(true)
    await voice.enableAudio()
    expect(voice.audioBlocked.value).toBe(false)
  })

  it('counts track failures even when the already-blocked room suppresses another status event', async () => {
    const r = await setup()
    const audio = track('microphone')
    const p = participant('one', [audio])
    r.remoteParticipants.set('one', p)
    r.emit('subscribed', audio, p.audioTrackPublications.get(0), p)
    r.canPlaybackAudio = false
    r.emit('audioPlaybackChanged')
    let played!: () => void
    r.startAudio.mockImplementationOnce(() => new Promise<void>(resolve => (played = resolve)))
    const retry = voice.enableAudio()
    audio.emit('audioPlaybackFailed', new Error('Gesture required'))
    r.canPlaybackAudio = true
    played()
    await retry
    expect(voice.audioBlocked.value).toBe(true)
    await voice.enableAudio()
    expect(voice.audioBlocked.value).toBe(false)
    await voice.leave(false)
    expect(audio.listenerCount('audioPlaybackFailed')).toBe(0)
    audio.emit('audioPlaybackFailed', new Error('Stale failure'))
    expect(voice.audioBlocked.value).toBe(false)
  })

  it('does not let an older retry clear a newer subscription playback failure', async () => {
    const r = await setup()
    let played!: () => void
    r.startAudio.mockImplementationOnce(() => new Promise<void>(resolve => (played = resolve)))
    const retry = voice.enableAudio()
    r.canPlaybackAudio = false
    r.emit('audioPlaybackChanged')
    r.canPlaybackAudio = true
    played()
    await retry
    expect(voice.audioBlocked.value).toBe(true)
    await voice.enableAudio()
    expect(voice.audioBlocked.value).toBe(false)
  })

  it('retains subscription playback failures until a successful retry', async () => {
    const r = await setup()
    r.canPlaybackAudio = false
    r.emit('audioPlaybackChanged')
    r.canPlaybackAudio = true
    r.emit('audioPlaybackChanged')
    expect(voice.audioBlocked.value).toBe(true)
    await voice.enableAudio()
    expect(voice.audioBlocked.value).toBe(false)
  })

  it('resumes room and processor audio synchronously from the same recovery gesture', async () => {
    const r = await setup()
    mocks.processorState!(true)
    expect(voice.audioBlocked.value).toBe(true)
    let resumed!: () => void
    r.startAudio.mockImplementationOnce(() => new Promise<void>(resolve => (resumed = resolve)))
    mocks.resumeProcessor.mockClear()
    const retry = voice.enableAudio()
    expect(mocks.resumeProcessor).toHaveBeenCalledOnce()
    mocks.processorState!(false)
    resumed()
    await retry
    expect(voice.audioBlocked.value).toBe(false)
  })

  it('makes processor recovery available while microphone initialization is still pending', async () => {
    let prepared!: () => void
    mocks.prepareProcessor.mockImplementationOnce(() => {
      mocks.processorState!(true)
      return new Promise<void>(resolve => (prepared = resolve))
    })
    const mod = await import('~/composables/useVoice')
    mod.useVoiceLive()
    voice = mod.useVoice()
    await voice.join('channel')
    await vi.waitFor(() => expect(mocks.prepareProcessor).toHaveBeenCalled())
    expect(voice.microphone.value).toBe('starting')
    expect(voice.audioBlocked.value).toBe(true)
    mocks.resumeProcessor.mockImplementationOnce(async () => {
      mocks.processorState!(false)
      prepared()
    })
    await voice.enableAudio()
    await vi.waitFor(() => expect(voice.microphone.value).toBe('ready'))
    expect(voice.audioBlocked.value).toBe(false)
  })

  it('destroys a processor cancelled before LiveKit has adopted it', async () => {
    let prepared!: () => void
    mocks.prepareProcessor.mockImplementationOnce(() => {
      mocks.processorState!(true)
      return new Promise<void>(resolve => (prepared = resolve))
    })
    const mod = await import('~/composables/useVoice')
    mod.useVoiceLive()
    voice = mod.useVoice()
    await voice.join('channel')
    await vi.waitFor(() => expect(mocks.prepareProcessor).toHaveBeenCalled())
    await voice.leave(false)
    expect(mocks.destroyProcessor).toHaveBeenCalledOnce()
    prepared()
    await vi.waitFor(() => expect(media.rooms[0]!.mic.stop).toHaveBeenCalled())
    expect(voice.microphone.value).toBe('idle')
  })

  it('preserves a new processor when the previous room finishes disconnecting', async () => {
    const r = await setup()
    let disconnected!: () => void
    r.disconnect.mockImplementationOnce(() => new Promise<void>(resolve => (disconnected = resolve)))
    const leaving = voice.leave(false)
    await voice.join('next')
    await vi.waitFor(() => expect(voice.microphone.value).toBe('ready'))
    disconnected()
    await leaving
    mocks.processorState!(true)
    mocks.resumeProcessor.mockClear()
    await voice.enableAudio()
    expect(mocks.resumeProcessor).toHaveBeenCalledOnce()
  })

  it('ignores recovery and processor state from a room that was left', async () => {
    await setup()
    const report = mocks.processorState!
    let resumed!: () => void
    mocks.resumeProcessor.mockImplementationOnce(() => new Promise<void>(resolve => (resumed = resolve)))
    const retry = voice.enableAudio()
    await voice.leave(false)
    report(true)
    resumed()
    await retry
    expect(voice.audioBlocked.value).toBe(false)
  })

  it('exposes initial and later playback failures and retries audio on demand', async () => {
    media.connect = () => {
      const r = media.rooms.at(-1)!
      r.canPlaybackAudio = false
      r.startAudio.mockRejectedValueOnce(new Error('Gesture required'))
    }
    const r = await setup()
    expect(voice.audioBlocked.value).toBe(true)
    expect(voice.connectionLabel.value).toBe('Audio blocked')
    r.startAudio.mockRejectedValueOnce(new Error('Still blocked'))
    await voice.enableAudio()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not enable audio' }))
    r.canPlaybackAudio = true
    await voice.enableAudio()
    expect(voice.audioBlocked.value).toBe(false)
    r.canPlaybackAudio = false
    r.emit('audioPlaybackChanged')
    expect(voice.audioBlocked.value).toBe(true)
    await voice.leave(false)
    r.emit('audioPlaybackChanged')
    expect(voice.audioBlocked.value).toBe(false)
  })
})

describe('microphone device changes', () => {
  it('shows the unplugged toast without switching when no mic is saved (Firefox: LiveKit recovers)', async () => {
    const r = await setup()
    available = [mic('a'), mic('b')]
    await deviceChange()
    r.getActiveDevice.mockReturnValue('a')
    available = [mic('b')]
    await deviceChange()
    expect(r.switchActiveDevice).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Your microphone was unplugged' }))
  })

  it('falls back with a non-exact default when the saved mic is unplugged, keeping the preference, and switches back on replug', async () => {
    available = [mic('a'), mic('b')]
    settings = ref({ ...settings.value, mic: mic('a') })
    const r = await setup()
    r.getActiveDevice.mockReturnValue('a')
    available = [mic('b')]
    await deviceChange()
    expect(r.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default', false)
    expect(settings.value.mic!.deviceId).toBe('a')
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Your microphone was unplugged' }))
    r.getActiveDevice.mockReturnValue('b')
    available = [mic('a'), mic('b')]
    await deviceChange()
    expect(r.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'a')
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Switched back to a', color: 'info' }))
    expect(settings.value.mic!.deviceId).toBe('a')
  })

  it('clears the saved mic and switches the live input non-exactly when System default is picked', async () => {
    settings = ref({ ...settings.value, mic: mic('a') })
    const r = await setup()
    await voice.pickDevice('mic', device('default'))
    expect(settings.value.mic).toBeUndefined()
    expect(r.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default', false)
  })

  it('shows the switch-failure toast without throwing when switching back fails', async () => {
    available = [mic('b')]
    settings = ref({ ...settings.value, mic: mic('a') })
    const r = await setup()
    r.switchActiveDevice.mockRejectedValue(new Error('Busy'))
    available = [mic('a'), mic('b')]
    await deviceChange()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not switch device', description: 'Busy' }))
  })

  it('restarts the mic when the label of the default entry changes and no mic is saved', async () => {
    available = [mic('default', 'Earbuds'), mic('a')]
    const r = await setup()
    await deviceChange()
    expect(r.restartTrack).not.toHaveBeenCalled()
    available = [mic('default', 'Speakers'), mic('a')]
    await deviceChange()
    expect(r.restartTrack).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('restarts the mic when the default label changes even if "System default" was picked explicitly', async () => {
    available = [mic('default', 'Earbuds'), mic('a')]
    settings = ref({ ...settings.value, mic: mic('default', 'Earbuds') })
    const r = await setup()
    await deviceChange()
    available = [mic('default', 'Speakers'), mic('a')]
    await deviceChange()
    expect(r.restartTrack).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('speaking off-delay', () => {
  it('turns on at once, holds after silence and cancels the off when speech resumes', async () => {
    vi.useFakeTimers()
    try {
      const { SPEAKING_HOLD_MS } = await import('~/composables/useVoice')
      const r = await setup()
      const speaking = () => voice.tiles.value[0]!.speaking
      r.emit('speakers', [r.localParticipant])
      expect(speaking()).toBe(true)
      r.emit('speakers', [])
      vi.advanceTimersByTime(SPEAKING_HOLD_MS - 1)
      expect(speaking()).toBe(true)
      r.emit('speakers', [r.localParticipant])
      vi.advanceTimersByTime(SPEAKING_HOLD_MS)
      expect(speaking()).toBe(true)
      r.emit('speakers', [])
      vi.advanceTimersByTime(SPEAKING_HOLD_MS)
      expect(speaking()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
