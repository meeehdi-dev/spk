import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeSoundboardAudio, forgetSound, playSound, setSoundboardOutput, useSoundboard } from '~/composables/useSoundboard'

const media = vi.hoisted(() => ({
  settings: { value: { soundboard: { on: true, volume: 0.4 } } },
  players: [] as HTMLAudioElement[],
  play: vi.fn(),
  pause: vi.fn(),
  load: vi.fn(),
  setSinkId: vi.fn(),
}))
mockNuxtImport('useVoiceSettings', () => () => media.settings)
const board = vi.hoisted(() => ({
  send: vi.fn(),
  voice: { sid: 'sid', channelId: { value: 'ch' }, playing: { value: {} as Record<string, string> }, soundRest: { value: false } },
}))
mockNuxtImport('useVoice', () => () => board.voice)
mockNuxtImport('useSocket', () => () => ({ send: board.send }))

beforeEach(() => {
  vi.clearAllMocks()
  media.settings.value.soundboard = { on: true, volume: 0.4 }
  media.players = []
  media.play.mockResolvedValue(undefined)
  media.setSinkId.mockResolvedValue(undefined)
  setSoundboardOutput('media')
  registerEndpoint('/api/sounds/sound/file', () => ({ url: 'https://example.com/sound' }))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sound')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('AudioContext', vi.fn())
  vi.stubGlobal('Audio', function Audio(url: string) {
    const player = document.createElement('audio')
    player.src = url
    Object.defineProperties(player, {
      play: { value: media.play },
      pause: { value: media.pause },
      load: { value: media.load },
      setSinkId: { value: media.setSinkId, configurable: true },
    })
    media.players.push(player)
    return player
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob(['sound'], { type: 'audio/wav' }))),
  )
})
afterEach(async () => {
  closeSoundboardAudio()
  await flushPromises()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('direct soundboard playback', () => {
  it('plays cached file bytes directly, with independent overlapping players and no Web Audio', async () => {
    await playSound('sound')
    await playSound('sound')
    expect(fetch).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(media.players).toHaveLength(2)
    for (const player of media.players) {
      expect(player.src).toBe('blob:sound')
      expect(player.srcObject).toBeNull()
      expect(player.volume).toBe(0.4)
      expect(player.loop).toBe(false)
    }
    expect(media.play).toHaveBeenCalledTimes(2)
    expect(media.pause).not.toHaveBeenCalled()
    expect(media.setSinkId).toHaveBeenCalledWith('media')
    expect(AudioContext).not.toHaveBeenCalled()
  })

  it.each([2, -1, Number.NaN])('bounds legacy or invalid listening volume %s', async volume => {
    media.settings.value.soundboard.volume = volume
    await playSound('sound')
    expect(media.players[0]!.volume).toBe(Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.7)
  })

  it('keeps the off switch but permits saved-sound previews', async () => {
    media.settings.value.soundboard.on = false
    await playSound('sound')
    expect(fetch).not.toHaveBeenCalled()
    await playSound('sound', true)
    expect(media.play).toHaveBeenCalledOnce()
    expect(media.players[0]!.volume).toBe(0.4)
  })

  it('follows output changes for all active sounds and new playback', async () => {
    await playSound('sound')
    await playSound('sound')
    media.setSinkId.mockClear()
    setSoundboardOutput('other')
    await flushPromises()
    expect(media.setSinkId).toHaveBeenCalledTimes(2)
    expect(media.setSinkId).toHaveBeenLastCalledWith('other')
    await playSound('sound')
    expect(media.setSinkId).toHaveBeenLastCalledWith('other')
  })

  it('waits for routing and cancels playback if its sound is deleted while routing', async () => {
    let finish!: () => void
    media.setSinkId.mockImplementationOnce(() => new Promise<void>(resolve => (finish = resolve)))
    const pending = playSound('sound')
    await vi.waitFor(() => expect(media.setSinkId).toHaveBeenCalled())
    expect(media.play).not.toHaveBeenCalled()
    forgetSound('sound')
    finish()
    await pending
    expect(media.play).not.toHaveBeenCalled()
    expect(media.pause).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sound')
  })

  it('releases an ended player but keeps the file cached for replay', async () => {
    await playSound('sound')
    const player = media.players[0]!
    player.dispatchEvent(new Event('ended'))
    expect(player.hasAttribute('src')).toBe(false)
    expect(player.onended).toBeNull()
    expect(media.pause).toHaveBeenCalledOnce()
    expect(media.load).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    media.setSinkId.mockClear()
    setSoundboardOutput('other')
    expect(media.setSinkId).not.toHaveBeenCalled()
    await playSound('sound')
    expect(fetch).toHaveBeenCalledOnce()
    expect(media.play).toHaveBeenCalledTimes(2)
  })

  it('stops at the media-time limit and also enforces a wall-clock ceiling', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await playSound('sound')
    const player = media.players[0]!
    player.currentTime = 10
    player.dispatchEvent(new Event('timeupdate'))
    expect(media.pause).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await playSound('sound')
    await vi.advanceTimersByTimeAsync(9999)
    expect(media.pause).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(media.pause).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops pending downloads on layout disposal without allocating URLs or playing', async () => {
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => (finish = resolve)))
    const pending = playSound('sound')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    closeSoundboardAudio()
    finish(new Response('sound'))
    await pending
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(media.players).toHaveLength(0)
    expect(media.play).not.toHaveBeenCalled()
  })

  it('does not evict a replacement download when an old deleted download fails', async () => {
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => (finish = resolve)))
    const pending = playSound('sound')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    forgetSound('sound')
    await playSound('sound')
    finish(new Response('old sound'))
    await pending
    await playSound('sound')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(media.play).toHaveBeenCalledTimes(2)
  })

  it('retries failed downloads instead of caching error responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('missing', { status: 404 }))
    await playSound('sound')
    expect(media.play).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    await playSound('sound')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(media.play).toHaveBeenCalledOnce()
  })

  it('cleans up blocked or failed playback and can retry the cached sound', async () => {
    media.play.mockRejectedValueOnce(new Error('Autoplay blocked'))
    await playSound('sound')
    expect(media.pause).toHaveBeenCalledOnce()
    expect(media.players[0]!.hasAttribute('src')).toBe(false)
    await playSound('sound')
    expect(fetch).toHaveBeenCalledOnce()
    media.players[1]!.dispatchEvent(new Event('error'))
    expect(media.pause).toHaveBeenCalledTimes(2)
    expect(media.players[1]!.hasAttribute('src')).toBe(false)
  })

  it('stops active players and revokes cached URLs on layout disposal', async () => {
    await playSound('sound')
    await playSound('sound')
    closeSoundboardAudio()
    await flushPromises()
    expect(media.pause).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:sound')
    expect(media.players.every(player => !player.hasAttribute('src'))).toBe(true)
    await playSound('sound')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('useSoundboard', () => {
  it('disables pressing exactly while a sound plays in the channel, yours included', () => {
    board.voice.playing = ref({})
    board.voice.soundRest = ref(false)
    const { cooling, press } = useSoundboard()
    press('sound')
    expect(board.send).toHaveBeenCalledExactlyOnceWith({ type: 'voice:sound', sid: 'sid', soundId: 'sound' })
    expect(cooling.value).toBe(false) // until the server relays it back

    board.voice.playing.value = { me: 'i-lucide-bell' }
    expect(cooling.value).toBe(true)
    press('sound')
    expect(board.send).toHaveBeenCalledOnce()
    board.voice.playing.value = {}
    board.voice.soundRest.value = true
    expect(cooling.value).toBe(true)
    board.voice.soundRest.value = false
    expect(cooling.value).toBe(false)
    press('sound')
    expect(board.send).toHaveBeenCalledTimes(2)
  })
})
