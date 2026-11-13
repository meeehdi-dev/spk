import { describe, expect, it, vi } from 'vitest'

import { playBlip } from '~/composables/useNotify'

const media = vi.hoisted(() => {
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  const oscillator = { frequency: { value: 0 }, connect: () => gain, start: vi.fn(), stop: vi.fn() }
  const context = { currentTime: 0, createOscillator: () => oscillator, createGain: () => gain }
  return { gain, context, destination: {} }
})
vi.mock('~/utils/media-audio', () => ({
  playMediaAudio: (play: (context: typeof media.context, destination: object) => void) => play(media.context, media.destination),
}))

describe('message sound output', () => {
  it('routes both notes through media output at the notification volume', () => {
    playBlip(0.5)
    expect(media.gain.connect).toHaveBeenCalledTimes(2)
    expect(media.gain.connect).toHaveBeenCalledWith(media.destination)
    expect(media.gain.gain.setValueAtTime).toHaveBeenCalledWith(0.15, 0)
    expect(media.gain.gain.setValueAtTime).toHaveBeenCalledWith(0.15, 0.09)
  })
})
