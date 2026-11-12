// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef, watch } from 'vue'

import { createDb } from '../server/db/client'
import { channels } from '../server/db/schema'
import { handleVoiceFrame, dropVoiceSocket } from '../server/utils/voice'
import * as sessions from '../server/utils/voicePresence'

const { media, MockRoom } = vi.hoisted(() => {
  class MockRoom {
    events = new Map<string, ((...args: unknown[]) => void)[]>()
    remoteParticipants = new Map()
    localParticipant = { identity: 'local', isLocal: true, getTrackPublication: () => undefined, setMicrophoneEnabled: vi.fn(async () => {}) }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.events.set(event, [...(this.events.get(event) ?? []), fn])
      return this
    }
    rejectConnect?: (e: Error) => void
    emit(event: string) {
      for (const fn of this.events.get(event) ?? []) fn()
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
    constructor() {
      media.rooms.push(this)
    }
  }
  const media = { rooms: [] as MockRoom[], connect: undefined as undefined | (() => Promise<void>) }
  return { media, MockRoom }
})
vi.mock('~/utils/voice-processor', () => ({ MicProcessor: vi.fn() }))
vi.mock('livekit-client', () => ({
  Track: { Kind: { Audio: 'audio' } },
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
}))

type Frame = Record<string, unknown>
let clients: Array<{ userId: string; receive: (m: Frame) => void; owner: { send: (s: string) => void } }>
let frames: Frame[]
let ack: boolean
let db: ReturnType<typeof createDb>
const sound = vi.fn()
const toast = vi.fn()
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

async function browser(userId: string) {
  vi.resetModules()
  const handlers = new Set<(m: Frame) => void>()
  const connected = ref(true)
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
  vi.stubGlobal('useSocket', () => ({
    connected,
    send,
    on: (h: (m: Frame) => void) => {
      handlers.add(h)
      return () => handlers.delete(h)
    },
    onOpen: vi.fn(),
  }))
  vi.stubGlobal('useMe', () => ({ data: ref({ id: userId }) }))
  const mod = await import('../app/composables/useVoice')
  mod.useVoiceLive()
  const v = mod.useVoice()
  return { ...mod, v, receive, send, connected, handlers, owner }
}

beforeEach(() => {
  db = createDb(':memory:')
  db.insert(channels)
    .values([
      { id: 'c1', type: 'voice', name: 'One' },
      { id: 'c2', type: 'voice', name: 'Two' },
      { id: 'text', type: 'text', name: 'Text' },
    ])
    .run()
  clients = []
  frames = []
  ack = true
  media.rooms = []
  media.connect = undefined
  sound.mockClear()
  toast.mockClear()
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useLocalStorage', (_: string, value: unknown) => ref(value))
  vi.stubGlobal('useVoiceSettings', () => ref({ noise: 'standard', sensitivity: 50, outputVolume: 1 }))
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useSounds', () => ({ data: ref([]) }))
  vi.stubGlobal('playVoiceSound', sound)
  vi.stubGlobal('navigateTo', vi.fn())
  vi.stubGlobal('onMounted', vi.fn())
  vi.stubGlobal('useEventListener', vi.fn())
  vi.stubGlobal('useWakeLock', () => ({ request: async () => {}, release: async () => {} }))
  vi.stubGlobal(
    '$fetch',
    vi.fn(async () => ({ token: 'token', url: 'url' })),
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }), enumerateDevices: async () => [] },
  })
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
  for (const c of clients) dropVoiceSocket(c.owner)
  db.$client.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('acknowledged voice join', () => {
  it('keeps mute across leave and applies it on join', async () => {
    const b = await browser('mute')
    b.v.toggleMic()
    await b.v.join('c1')
    expect(sessions.voiceSnapshot().find(p => p.userId === 'mute')).toMatchObject({ muted: true })
    await b.v.leave()
    expect(b.v.mute.value.muted).toBe(true)
  })

  it('mutes the published mic before the processor loads when joining muted', async () => {
    const b = await browser('early')
    b.v.toggleMic()
    const order: string[] = []
    const track = {
      mute: vi.fn(async () => void order.push('mute')),
      unmute: vi.fn(async () => {}),
      setProcessor: vi.fn(async () => void order.push('processor')),
    }
    media.connect = async () => {
      media.rooms[0]!.localParticipant.getTrackPublication = (() => ({ audioTrack: track })) as never
    }
    await b.v.join('c1')
    expect(order.slice(0, 2)).toEqual(['mute', 'processor'])
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
      expect(original.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
      expect(sessions.sessionOf('middle')?.channelId).toBe('c2')
    }
    b.receive({ type: 'voice:move', sid: b.v.sid, channelId: 'c2' })
    expect(sessions.sessionOf('middle')).toBeNull()
    expect(b.v.channelId.value).toBeNull()
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
    expect(original.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
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
