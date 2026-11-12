import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), click: vi.fn(), send: vi.fn() }))
vi.mock('../server/utils/radioApi', () => ({ getRadioStation: mocks.lookup, countRadioClick: mocks.click, isStationId: (id: unknown) => id === 'station' }))
vi.mock('../server/utils/peers', () => ({ sendToUser: mocks.send, broadcast: vi.fn() }))

let radio: typeof import('../server/utils/radio')
let presence: typeof import('../server/utils/voicePresence')
let state: typeof import('../server/utils/radioState')
const station = { id: 'station', name: 'Radio', url: 'https://stream.example.com/live', codec: 'MP3', country: 'FR' }
let replies: Array<Record<string, unknown>>
let owner: { send: (raw: string) => void }
const set = (user = 'u', sid = 's', peer = owner) => radio.handleRadioFrame(user, { type: 'voice:radio:set', stationId: 'station', sid }, peer)
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.lookup.mockResolvedValue(station)
  mocks.click.mockResolvedValue(undefined)
  replies = []
  owner = {
    send: raw => {
      replies.push(JSON.parse(raw))
    },
  }
  presence = await import('../server/utils/voicePresence')
  state = await import('../server/utils/radioState')
  radio = await import('../server/utils/radio')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('channel radio commands', () => {
  it('requires a ready session, matching sid and owning socket', async () => {
    await set()
    await radio.handleRadioFrame('u', { type: 'voice:radio:stop', sid: 's' }, owner)
    presence.joinVoice('u', 'c', 's', owner, false)
    await set()
    presence.readyVoice('u', 's')
    await set('u', 'wrong')
    await set('u', 's', { send: owner.send })
    expect(replies).toHaveLength(5)
    expect(replies.every(r => r.type === 'voice:radio:error')).toBe(true)
    expect(mocks.lookup).not.toHaveBeenCalled()
  })
  it('shares station state, supplies late join/reconnect snapshots, and limits changes', async () => {
    presence.joinVoice('u', 'c', 's', owner)
    presence.joinVoice('v', 'c', 't', {})
    await set()
    expect(state.channelRadio('c').state.station).toEqual(station)
    expect(mocks.send.mock.calls.map(([id, frame]) => [id, frame.station])).toEqual([
      ['u', station],
      ['v', station],
    ])
    presence.joinVoice('late', 'c', 'late-sid', owner)
    await radio.handleRadioFrame('late', { type: 'voice:radio:get', sid: 'late-sid' }, owner)
    expect(replies.at(-1)).toMatchObject({ station, channelId: 'c', sid: 'late-sid' })
    presence.joinVoice('late', 'c', 'late-sid', owner)
    await radio.handleRadioFrame('late', { type: 'voice:radio:get', sid: 'late-sid' }, owner)
    expect(replies.at(-1)).toMatchObject({ station })
    await radio.handleRadioFrame('u', { type: 'voice:radio:stop', sid: 's' }, owner)
    expect(replies.at(-1)?.error).toMatch(/three seconds/)
    vi.advanceTimersByTime(3000)
    await radio.handleRadioFrame('u', { type: 'voice:radio:stop', sid: 's' }, owner)
    expect(state.channelRadio('c').state.station).toBeNull()
  })
  it('serializes selections and stop commands across users', async () => {
    presence.joinVoice('u', 'c', 's', owner)
    presence.joinVoice('v', 'c', 't', owner)
    let resolve!: (value: typeof station) => void
    mocks.lookup.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r
        }),
    )
    const first = set()
    await tick()
    const stop = radio.handleRadioFrame('v', { type: 'voice:radio:stop', sid: 't' }, owner)
    resolve(station)
    await Promise.all([first, stop])
    expect(state.channelRadio('c').state.station).toBeNull()
    const frames = mocks.send.mock.calls.map(([, frame]) => frame)
    expect(frames.at(-1).revision).toBeGreaterThan(frames[0].revision)
  })
  it('rejects a lookup that finishes after leave, move, takeover, or socket close', async () => {
    for (const change of ['leave', 'move', 'takeover', 'close']) {
      vi.advanceTimersByTime(3000)
      presence.joinVoice('u', 'c', 's', owner)
      let resolve!: (value: typeof station) => void
      mocks.lookup.mockImplementation(
        () =>
          new Promise(r => {
            resolve = r
          }),
      )
      const pending = set()
      await tick()
      if (change === 'leave') presence.leaveVoice('u', 's')
      if (change === 'move') presence.joinVoice('u', 'elsewhere', 's', owner)
      if (change === 'takeover') presence.joinVoice('u', 'c', 'new', {})
      if (change === 'close') presence.dropVoiceOwner(owner)
      resolve(station)
      await pending
      expect(state.channelRadio('c').state.station).toBeNull()
      presence.leaveVoice('u', 'new')
      presence.leaveVoice('u', 's')
    }
  })
  it('keeps playback when the selector leaves and clears state when the last member leaves', async () => {
    presence.joinVoice('u', 'c', 's', owner)
    presence.joinVoice('v', 'c', 't', owner)
    await set()
    const old = state.channelRadio('c')
    presence.leaveVoice('u', 's')
    expect(state.channelRadio('c').state.station).toEqual(station)
    presence.dropVoiceOwner(owner)
    expect(state.isCurrentRadio('c', old)).toBe(false)
    expect(state.channelRadio('c').state.station).toBeNull()
  })
  it('does not restore state after channel deletion or apply an invalid station', async () => {
    presence.joinVoice('u', 'c', 's', owner)
    let resolve!: (value: typeof station) => void
    mocks.lookup.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r
        }),
    )
    const pending = set()
    await tick()
    state.clearChannelRadio('c')
    resolve(station)
    await pending
    expect(state.channelRadio('c').state.station).toBeNull()
    vi.advanceTimersByTime(3000)
    mocks.lookup.mockRejectedValue(new Error('Unsupported stream'))
    await set()
    expect(replies.at(-1)?.error).toBe('Unsupported stream')
    expect(state.channelRadio('c').state.station).toBeNull()
  })
})
