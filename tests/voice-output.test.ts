import type { Ref } from 'vue'

// @vitest-environment happy-dom
import type { VoiceSettings } from '../app/composables/useVoiceSettings'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef, watch } from 'vue'

const { media, MockRoom } = vi.hoisted(() => {
  class MockRoom {
    events = new Map<string, ((...args: unknown[]) => void)[]>()
    remoteParticipants = new Map()
    restartTrack = vi.fn(async () => {})
    localParticipant = {
      identity: 'local',
      isLocal: true,
      getTrackPublication: () => ({ audioTrack: { restartTrack: this.restartTrack, setProcessor: async () => {}, mute: vi.fn(), unmute: vi.fn() } }),
      setMicrophoneEnabled: vi.fn(),
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
    startAudio = vi.fn(async () => {})
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
    ActiveSpeakersChanged: 'speakers',
  },
  Room: MockRoom,
}))

const device = (deviceId: string) => ({ deviceId, label: deviceId, kind: 'audiooutput' })
const mic = (deviceId: string, label = deviceId) => ({ deviceId, label, kind: 'audioinput' })
const toast = vi.fn()
let settings: Ref<Partial<VoiceSettings>>
let available: Array<{ deviceId: string; label: string; kind: string }>
let deviceChange: () => Promise<void>
let voice: ReturnType<typeof import('../app/composables/useVoice').useVoice>

function track(source: string) {
  const element = document.createElement('audio')
  return { source, kind: 'audio', attach: () => element, detach: () => [element], setSinkId: vi.fn(async (_id: string) => {}), setVolume: vi.fn() }
}
function participant(id: string, tracks: ReturnType<typeof track>[]) {
  const pubs = new Map(tracks.map((t, i) => [i, { source: t.source, track: t, isDesired: true, setSubscribed: vi.fn() }]))
  return { identity: id, audioTrackPublications: pubs, trackPublications: pubs, videoTrackPublications: new Map(), getTrackPublication: () => undefined }
}
async function setup(supported = true) {
  if (supported) Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: vi.fn() })
  else Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId')
  const mod = await import('../app/composables/useVoice')
  mod.useVoiceLive()
  voice = mod.useVoice()
  await voice.join('channel')
  expect(voice.channelId.value).toBe('channel')
  return media.rooms[0]!
}

beforeEach(() => {
  vi.resetModules()
  media.rooms = []
  media.connect = undefined
  toast.mockClear()
  available = [device('voice'), device('screen'), device('other')]
  settings = ref({ speaker: device('voice'), screenSpeaker: device('screen'), noise: 'standard', sensitivity: 50, outputVolume: 0.8 })
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useLocalStorage', (_: string, value: unknown) => ref(value))
  vi.stubGlobal('useVoiceSettings', () => settings)
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useMe', () => ({ data: ref({ id: 'local' }) }))
  vi.stubGlobal('playVoiceSound', vi.fn())
  vi.stubGlobal('onMounted', vi.fn())
  vi.stubGlobal('useEventListener', (_target: unknown, event: string, fn: () => Promise<void>) => {
    if (event === 'devicechange') deviceChange = fn
  })
  vi.stubGlobal('useWakeLock', () => ({ request: async () => {}, release: async () => {} }))
  vi.stubGlobal(
    '$fetch',
    vi.fn(async () => ({ token: 'token', url: 'url' })),
  )
  const handlers = new Set<(m: Record<string, unknown>) => void>()
  vi.stubGlobal('useSocket', () => ({
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
})

describe('independent remote audio outputs', () => {
  it.each([true, false])('defaults screen audio independently for a saved voice preference: %s', async savedVoice => {
    settings.value.screenSpeaker = undefined
    if (!savedVoice) settings.value.speaker = undefined
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    media.connect = () => {
      const r = media.rooms.at(-1)!
      r.emit('subscribed', mic)
      r.emit('subscribed', screen)
    }
    await setup()
    expect(mic.setSinkId).toHaveBeenLastCalledWith(savedVoice ? 'voice' : '')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('')
    expect(settings.value.speaker?.deviceId).toBe(savedVoice ? 'voice' : undefined)
    expect(settings.value.screenSpeaker).toBeUndefined()
  })

  it('routes subscriptions before room assignment, later subscriptions and rejoins using saved preferences', async () => {
    const mic = track('microphone'),
      screen = track('screen_share_audio')
    media.connect = () => {
      const r = media.rooms.at(-1)!
      expect(voice.activeRoom()).toBeUndefined()
      r.emit('subscribed', mic)
      r.emit('subscribed', screen)
    }
    const r = await setup()
    expect(r.options.audioOutput).toBeUndefined()
    expect(mic.setSinkId).toHaveBeenLastCalledWith('voice')
    expect(screen.setSinkId).toHaveBeenLastCalledWith('screen')
    const later = track('screen_share_audio')
    r.emit('subscribed', later)
    expect(later.setSinkId).toHaveBeenLastCalledWith('screen')
    r.emit('unsubscribed', later)
    expect(document.body.contains(later.attach())).toBe(false)
    r.emit('subscribed', later)
    expect(later.setSinkId).toHaveBeenCalledTimes(2)
    await voice.leave(false)
    settings.value.screenSpeaker = undefined
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
    await voice.pickDevice('screenSpeaker', device('other'))
    expect(mic.setSinkId).not.toHaveBeenCalled()
    expect(screen.setSinkId).toHaveBeenLastCalledWith('other')
    expect(otherScreen.setSinkId).toHaveBeenLastCalledWith('other')
    await voice.pickDevice('speaker', device('default'))
    expect(settings.value.speaker).toBeUndefined()
    expect(settings.value.screenSpeaker!.deviceId).toBe('other')
    expect(mic.setSinkId).toHaveBeenLastCalledWith('')
    expect(screen.setSinkId).toHaveBeenCalledTimes(1)
    await voice.pickDevice('screenSpeaker', device('default'))
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
    r.emit('subscribed', screen)
    await voice.pickDevice('screenSpeaker', device('other'))
    expect(voice.canPickOutput).toBe(false)
    expect(screen.setSinkId).not.toHaveBeenCalled()
    expect(document.body.contains(screen.attach())).toBe(true)
  })

  it('shows subscription and live-switch failures without rejecting', async () => {
    const r = await setup()
    const screen = track('screen_share_audio')
    screen.setSinkId.mockRejectedValue(new Error('Denied'))
    r.remoteParticipants.set('one', participant('one', [screen]))
    r.emit('subscribed', screen)
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not switch device', description: 'Denied' })))
    toast.mockClear()
    await voice.pickDevice('screenSpeaker', device('other'))
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
    settings.value.screenSpeaker = device('voice')
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
      const { SPEAKING_HOLD_MS } = await import('../app/composables/useVoice')
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
