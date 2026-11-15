import { ServerError } from 'livekit-server-sdk'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { dropVoiceSocket } from '~~/server/utils/voice'
import * as presence from '~~/server/utils/voicePresence'

const { getParticipant } = vi.hoisted(() => ({ getParticipant: vi.fn() }))
vi.mock('livekit-server-sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    getParticipant = getParticipant
  },
}))
const broadcast = vi.fn()
const gone = () => new ServerError('Not Found', 'participant not found', 404, 'not_found')
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  getParticipant.mockReset().mockResolvedValue({ identity: 'u' })
  broadcast.mockClear()
  vi.stubGlobal('broadcast', broadcast)
  vi.stubGlobal('useRuntimeConfig', () => ({ livekit: { apiKey: 'key', apiSecret: 'secret' }, public: { livekitUrl: 'wss://rtc.example.com' } }))
  for (const [name, fn] of Object.entries(presence)) vi.stubGlobal(name, fn)
})
afterEach(() => {
  presence.leaveVoice('u', 's')
  presence.leaveVoice('u', 'next')
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps healthy voice indefinitely after app socket loss, then cleans up a confirmed departure', async () => {
  const owner = {}
  presence.joinVoice('u', 'c', 's', owner)
  dropVoiceSocket(owner)
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  expect(presence.sessionOf('u')).toEqual({ sid: 's', channelId: 'c' })
  expect(broadcast).not.toHaveBeenCalled()
  getParticipant.mockRejectedValue(gone())
  await vi.advanceTimersByTimeAsync(20_000)
  expect(presence.sessionOf('u')).toBeNull()
  expect(broadcast).toHaveBeenCalledExactlyOnceWith({ type: 'voice:presence', userId: 'u', channelId: null })
  expect(vi.getTimerCount()).toBe(0)
})

it('does not treat LiveKit errors as departure and retries checking membership', async () => {
  getParticipant.mockRejectedValue(new Error('network unavailable'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const owner = {}
  presence.joinVoice('u', 'c', 's', owner)
  dropVoiceSocket(owner)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(presence.sessionOf('u')).not.toBeNull()
  expect(broadcast).not.toHaveBeenCalled()
  getParticipant.mockRejectedValue(gone())
  await vi.advanceTimersByTimeAsync(20_000)
  expect(presence.sessionOf('u')).toBeNull()
  warn.mockRestore()
})

it.each(['s', 'next'])('ignores a stale departure check after ownership transfers to sid %s', async sid => {
  let reject!: (e: Error) => void
  getParticipant.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  const owner = {}
  presence.joinVoice('u', 'c', 's', owner)
  dropVoiceSocket(owner)
  presence.joinVoice('u', 'c', sid, {})
  reject(gone())
  await flush()
  expect(presence.sessionOf('u')).toEqual({ sid, channelId: 'c' })
  expect(broadcast).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('cleans up never-ready joins without a leave announcement or a LiveKit check', () => {
  const owner = {}
  presence.joinVoice('u', 'c', 's', owner, false)
  dropVoiceSocket(owner)
  expect(presence.sessionOf('u')).toBeNull()
  expect(getParticipant).not.toHaveBeenCalled()
  expect(broadcast).not.toHaveBeenCalled()
})

it('does not resurrect an explicit leave while a membership check is pending', async () => {
  let resolve!: (value: unknown) => void
  getParticipant.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done
      }),
  )
  const owner = {}
  presence.joinVoice('u', 'c', 's', owner)
  dropVoiceSocket(owner)
  presence.leaveVoice('u', 's')
  resolve({ identity: 'u' })
  await flush()
  expect(presence.sessionOf('u')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
