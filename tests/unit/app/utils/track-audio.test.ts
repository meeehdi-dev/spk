import type { RemoteAudioTrack } from 'livekit-client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTrackAudio } from '~/utils/track-audio'

const node = () => ({ connect: vi.fn((target: object) => target), disconnect: vi.fn() })
let sources: ReturnType<typeof node>[]
let gains: Array<ReturnType<typeof node> & { gain: { value: number } }>
let stops: ReturnType<typeof vi.fn>[]
let outputs: object[]
let contexts: Array<{ state: string; onstatechange: (() => void) | null }>
const resume = vi.fn(async () => {})
const close = vi.fn(async () => {})
const blocked = vi.fn()
let mixer: ReturnType<typeof createTrackAudio>

function track() {
  const element = { srcObject: null as unknown, isConnected: false, volume: 1, play: vi.fn(async () => {}) }
  const t = {
    attachedElements: [element],
    mediaStreamTrack: { enabled: true },
    setVolume: vi.fn((volume: number) => {
      if (volume < 0 || volume > 1) throw new Error('Invalid HTML volume')
      element.volume = volume
    }),
    attach: vi.fn(() => {
      expect(element.volume).toBe(0)
      return element
    }),
  }
  return t as unknown as RemoteAudioTrack
}

beforeEach(() => {
  vi.clearAllMocks()
  resume.mockResolvedValue()
  sources = []
  gains = []
  stops = []
  outputs = []
  contexts = []
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(public tracks: unknown[]) {}
    },
  )
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      onstatechange: (() => void) | null = null
      constructor() {
        contexts.push(this)
      }
      resume = resume
      close = close
      createMediaStreamSource() {
        const source = node()
        sources.push(source)
        return source
      }
      createGain() {
        const gain = { ...node(), gain: { value: 1 } }
        gains.push(gain)
        return gain
      }
      createMediaStreamDestination() {
        const stop = vi.fn()
        stops.push(stop)
        const stream = { getTracks: () => [{ stop }] }
        outputs.push(stream)
        return { stream }
      }
    },
  )
  vi.stubGlobal('document', {
    body: {
      append: vi.fn(element => {
        element.isConnected = true
      }),
    },
  })
  mixer = createTrackAudio(blocked)
})
afterEach(() => {
  mixer.close()
  vi.unstubAllGlobals()
})

describe('remote playback amplification', () => {
  it('keeps ordinary playback direct, then amplifies to four without invalid element volume or duplicate attachment', () => {
    const t = track()
    mixer.volume(t, 0.4)
    expect(t.setVolume).toHaveBeenLastCalledWith(0.4)
    expect(gains).toHaveLength(0)
    mixer.volume(t, 4)
    mixer.attach(t)
    mixer.attach(t)
    expect(gains[0]!.gain.value).toBe(4)
    expect(t.attachedElements[0]!.srcObject).toBe(outputs[0])
    expect(t.setVolume).toHaveBeenLastCalledWith(1)
    expect(t.attach).toHaveBeenCalledOnce()
    expect(t.attachedElements[0]!.play).toHaveBeenCalledOnce()
    mixer.volume(t, 0)
    expect(gains[0]!.gain.value).toBe(0)
    mixer.volume(t, 0.5)
    expect(gains[0]!.gain.value).toBe(0.5)
  })

  it('keeps tracks separate, rewires native replacements and releases only owned nodes and streams', () => {
    const mic = track(),
      screen = track()
    mixer.volume(mic, 2)
    mixer.volume(screen, 3)
    mixer.attach(mic)
    mixer.attach(screen)
    expect(outputs[0]).not.toBe(outputs[1])
    Object.defineProperty(mic, 'mediaStreamTrack', { value: { enabled: true } })
    mixer.volume(mic, 4)
    expect(sources[0]!.disconnect).toHaveBeenCalledOnce()
    expect(sources).toHaveLength(3)
    mixer.forget(mic)
    expect(stops[0]).toHaveBeenCalledOnce()
    expect(stops[1]).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    mixer.close()
    expect(stops[1]).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports later context interruption even at ordinary volume and resumes through retry', async () => {
    const t = track()
    mixer.volume(t, 2)
    await Promise.resolve()
    const context = contexts[0]!
    context.state = 'suspended'
    context.onstatechange!()
    expect(blocked).toHaveBeenCalledOnce()
    mixer.volume(t, 0.5)
    expect(gains[0]!.gain.value).toBe(0.5)
    await expect(mixer.resume()).rejects.toThrow('suspended')
    resume.mockImplementationOnce(async () => {
      context.state = 'running'
      context.onstatechange!()
    })
    await mixer.resume()
    expect(blocked).toHaveBeenCalledOnce()
    expect(t.attachedElements[0]!.srcObject).toBe(outputs[0])
  })

  it('ignores context state changes without graphs or after disposal', () => {
    const t = track()
    mixer.volume(t, 2)
    const context = contexts[0]!
    const stale = context.onstatechange!
    mixer.forget(t)
    context.state = 'suspended'
    stale()
    expect(blocked).not.toHaveBeenCalled()
    mixer.volume(track(), 2)
    mixer.close()
    expect(context.onstatechange).toBeNull()
    stale()
    expect(blocked).not.toHaveBeenCalled()
  })

  it('reports blocked contexts, retries resume and ignores failures after disposal', async () => {
    resume.mockRejectedValueOnce(new Error('Blocked'))
    mixer.volume(track(), 2)
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledOnce())
    await mixer.resume()
    expect(resume).toHaveBeenCalledTimes(2)
    resume.mockRejectedValueOnce(new Error('Late'))
    mixer.close()
    mixer.volume(track(), 2)
    mixer.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(blocked).toHaveBeenCalledOnce()
  })
})
