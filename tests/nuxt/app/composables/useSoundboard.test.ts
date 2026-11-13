import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetSound, playSound } from '~/composables/useSoundboard'

const media = vi.hoisted(() => {
  const source = { buffer: null, connect: vi.fn(), start: vi.fn() }
  const gain = { gain: { value: 0 }, connect: vi.fn() }
  const destination = {}
  const context = { state: 'running', decodeAudioData: vi.fn(async () => ({ duration: 30 })), createBufferSource: () => source, createGain: () => gain }
  source.connect.mockReturnValue(gain)
  return { context, destination, source, gain, settings: { value: { soundboard: { on: true, volume: 0.4 } } } }
})
mockNuxtImport('useVoiceSettings', () => () => media.settings)
vi.mock('~/utils/media-audio', () => ({
  getMediaAudio: () => ({ context: media.context }),
  playMediaAudio: (play: (context: typeof media.context, destination: object) => void) => play(media.context, media.destination),
}))

beforeEach(() => {
  vi.clearAllMocks()
  media.context.state = 'running'
  media.source.connect.mockReturnValue(media.gain)
  media.context.decodeAudioData.mockResolvedValue({ duration: 30 })
  forgetSound('sound')
  media.settings.value.soundboard = { on: true, volume: 0.4 }
  registerEndpoint('/api/sounds/sound/file', () => ({ url: 'https://example.com/sound' }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('soundboard media playback', () => {
  it('does not recreate playback after the layout closes while a sound is downloading', async () => {
    let finish!: () => void
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          finish = () => resolve(new Response(new ArrayBuffer(0)))
        }),
    )
    const pending = playSound('sound')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    media.context.state = 'closed'
    finish()
    await pending
    expect(media.source.start).not.toHaveBeenCalled()
  })

  it('uses the routed destination, preserving volume, duration limit and decoded cache', async () => {
    await playSound('sound')
    await playSound('sound')
    expect(fetch).toHaveBeenCalledOnce()
    expect(media.context.decodeAudioData).toHaveBeenCalledOnce()
    expect(media.gain.connect).toHaveBeenCalledWith(media.destination)
    expect(media.gain.gain.value).toBe(0.4)
    expect(media.source.start).toHaveBeenCalledWith(0, 0, 10)
  })

  it('keeps the off switch but allows a local preview at the same routed destination', async () => {
    media.settings.value.soundboard.on = false
    await playSound('sound')
    expect(fetch).not.toHaveBeenCalled()
    await playSound('sound', true)
    expect(media.gain.connect).toHaveBeenCalledOnce()
    expect(media.gain.connect).toHaveBeenCalledWith(media.destination)
  })
})
