import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRadioPlayer, type RadioPlayback } from '~/utils/radio-player'

class AudioMock {
  src = ''
  private level = 1
  get volume() {
    return this.level
  }
  set volume(value: number) {
    if (value < 0 || value > 1) throw new Error('Invalid HTML volume')
    this.level = value
  }
  crossOrigin: string | null = null
  srcObject: unknown = null
  muted = false
  preload = ''
  onplaying: (() => void) | null = null
  onerror: (() => void) | null = null
  onended: (() => void) | null = null
  playing = false
  play = vi.fn(async () => {
    this.playing = true
    this.onplaying?.()
  })
  pause() {
    this.playing = false
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }
  load() {}
  sink = ''
  async setSinkId(value: string) {
    this.sink = value
  }
}
let elements: AudioMock[]
let status: RadioPlayback
let player: ReturnType<typeof createRadioPlayer>
beforeEach(() => {
  elements = []
  vi.stubGlobal(
    'Audio',
    class extends AudioMock {
      constructor() {
        super()
        elements.push(this)
      }
    },
  )
  status = 'idle'
  player = createRadioPlayer(value => {
    status = value
  })
})
afterEach(() => {
  player.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('radio amplification', () => {
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  const source = { connect: vi.fn(() => gain), disconnect: vi.fn() }
  const stop = vi.fn()
  const close = vi.fn(async () => {})
  const resume = vi.fn(async () => {})
  const stream = { getTracks: () => [{ stop }] }
  let available: boolean | null
  let contextState: string
  beforeEach(() => {
    vi.clearAllMocks()
    gain.gain.value = 1
    available = null
    contextState = 'running'
    resume.mockResolvedValue()
    vi.stubGlobal(
      'AudioContext',
      class {
        get state() {
          return contextState
        }
        resume = resume
        close = close
        createGain = () => gain
        createMediaElementSource = () => source
        createMediaStreamDestination = () => ({ stream })
      },
    )
    player = createRadioPlayer(
      value => {
        status = value
      },
      value => {
        available = value
      },
    )
  })

  it('amplifies compatible streams to four, keeps element volume valid and routes only the output', async () => {
    player.output(4, false, 'media')
    await player.start('https://stream.example.com/cors')
    expect(available).toBe(true)
    expect(elements[0]!.crossOrigin).toBe('anonymous')
    expect(elements[0]!.volume).toBe(1)
    expect(elements[1]!.srcObject).toBe(stream)
    expect(elements[1]!.sink).toBe('media')
    expect(gain.gain.value).toBe(4)
    player.output(4, true, 'other')
    expect(gain.gain.value).toBe(0)
    expect(elements[0]!.muted).toBe(true)
    player.output(0.3, false, 'other')
    expect(gain.gain.value).toBe(0.3)
    expect(elements).toHaveLength(2)
    player.stop()
    expect(stop).toHaveBeenCalledOnce()
    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('falls back to a fresh direct element on CORS failure, preserves output and exposes the cap', async () => {
    player.output(4, true, 'media')
    await player.start('https://stream.example.com/no-cors')
    const stale = elements[0]!.onerror!
    stale()
    await vi.waitFor(() => expect(available).toBe(false))
    expect(elements).toHaveLength(3)
    expect(status).toBe('playing')
    expect(elements[2]!.crossOrigin).toBeNull()
    expect(elements[2]!.volume).toBe(1)
    expect(elements[2]!.muted).toBe(true)
    expect(elements[2]!.sink).toBe('media')
    expect(elements[0]!.src).toBe('')
    expect(close).toHaveBeenCalledOnce()
    stale()
    expect(elements).toHaveLength(3)
    player.output(0.2, false, 'media')
    expect(elements[2]!.volume).toBe(0.2)
    expect(elements[2]!.muted).toBe(false)
  })

  it('waits for the audio graph before reporting source playback as playing', async () => {
    let finish!: () => void
    contextState = 'suspended'
    resume.mockImplementationOnce(() => new Promise<void>(resolve => (finish = resolve)))
    const pending = player.start('https://stream.example.com/cors')
    expect(status).toBe('loading')
    expect(available).toBeNull()
    contextState = 'running'
    finish()
    await pending
    expect(status).toBe('playing')
    expect(available).toBe(true)
  })

  it.each(['context', 'output'])('keeps the watchdog active while %s readiness is pending and ignores stale completion', async pendingPart => {
    vi.useFakeTimers()
    let finish!: () => void
    const wait = () => new Promise<void>(resolve => (finish = resolve))
    if (pendingPart === 'context') {
      contextState = 'suspended'
      resume.mockImplementationOnce(wait)
    } else {
      vi.stubGlobal(
        'Audio',
        class extends AudioMock {
          constructor() {
            super()
            if (elements.length === 1) this.play = vi.fn(wait)
            elements.push(this)
          }
        },
      )
    }
    const pending = player.start('https://stream.example.com/cors')
    expect(status).toBe('loading')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(elements).toHaveLength(3)
    expect(elements[0]!.src).toBe('')
    expect(close).toHaveBeenCalledOnce()
    expect(status).toBe('playing')
    expect(available).toBe(false)
    finish()
    await pending
    expect(status).toBe('playing')
    expect(available).toBe(false)
  })

  it('does not mistake autoplay blocking for CORS incompatibility and permits a user retry', async () => {
    resume.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'))
    await player.start('https://stream.example.com/cors')
    expect(status).toBe('blocked')
    expect(elements).toHaveLength(2)
    await player.start('https://stream.example.com/cors')
    expect(status).toBe('playing')
    expect(available).toBe(true)
  })
})

describe('browser radio player', () => {
  it('replaces the stream and releases the previous connection', async () => {
    await player.start('https://stream.example.com/one')
    const first = elements[0]!
    const staleError = first.onerror!
    await player.start('https://stream.example.com/two')
    staleError()
    expect(first.playing).toBe(false)
    expect(first.src).toBe('')
    expect(elements[1]!.src).toBe('https://stream.example.com/two')
    expect(status).toBe('playing')
    player.stop()
    expect(elements[1]!.playing).toBe(false)
    expect(elements[1]!.src).toBe('')
    expect(status).toBe('idle')
  })
  it('reports blocked autoplay and allows a fresh manual attempt', async () => {
    vi.stubGlobal(
      'Audio',
      class extends AudioMock {
        constructor() {
          super()
          this.play = vi.fn(async () => {
            throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
          })
          elements.push(this)
        }
      },
    )
    await player.start('https://stream.example.com/live')
    expect(status).toBe('blocked')
    expect(elements[0]!.src).toBe('')
    vi.stubGlobal(
      'Audio',
      class extends AudioMock {
        constructor() {
          super()
          elements.push(this)
        }
      },
    )
    await player.start('https://stream.example.com/live')
    expect(status).toBe('playing')
  })
  it('ignores a rejected play promise after leaving or replacing the station', async () => {
    let reject!: (e: Error) => void
    vi.stubGlobal(
      'Audio',
      class extends AudioMock {
        constructor() {
          super()
          this.play = vi.fn(
            () =>
              new Promise<void>((_resolve, fail) => {
                reject = fail
              }),
          )
          elements.push(this)
        }
      },
    )
    const pending = player.start('https://stream.example.com/live')
    player.stop()
    reject(new Error('late failure'))
    await pending
    expect(status).toBe('idle')
  })
  it('applies local volume, deafen, and the selected output without restarting playback', async () => {
    player.output(0.25, false, 'headphones')
    await player.start('https://stream.example.com/live')
    const audio = elements[0]!
    expect(audio.volume).toBe(0.25)
    expect(audio.sink).toBe('headphones')
    player.output(0.4, true, 'headphones')
    expect(audio.muted).toBe(true)
    expect(audio.playing).toBe(true)
    player.output(0.4, false, 'headphones')
    expect(audio.muted).toBe(false)
    expect(elements).toHaveLength(1)
  })
  it('reports a stream that never begins playback and releases it after 15 seconds', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    vi.stubGlobal(
      'Audio',
      class extends AudioMock {
        constructor() {
          super()
          this.play = vi.fn(
            () =>
              new Promise<void>(resolve => {
                finish = resolve
              }),
          )
          elements.push(this)
        }
      },
    )
    const pending = player.start('https://stream.example.com/live')
    expect(status).toBe('loading')
    vi.advanceTimersByTime(15_000)
    expect(status).toBe('error')
    expect(elements[0]!.src).toBe('')
    finish()
    await pending
    vi.useRealTimers()
  })
  it('uses the default output if a selected device is no longer available', async () => {
    vi.stubGlobal(
      'Audio',
      class extends AudioMock {
        override async setSinkId(value: string) {
          if (value === 'missing') throw new Error('Device gone')
          this.sink = value
        }
        constructor() {
          super()
          elements.push(this)
        }
      },
    )
    player.output(0.5, false, 'missing')
    await player.start('https://stream.example.com/live')
    await Promise.resolve()
    expect(elements[0]!.sink).toBe('')
    expect(status).toBe('playing')
  })
  it('releases failed streams and does not retry without a user action', async () => {
    await player.start('https://stream.example.com/live')
    elements[0]!.onerror!()
    expect(status).toBe('error')
    expect(elements[0]!.src).toBe('')
    expect(elements).toHaveLength(1)
    await player.start('https://stream.example.com/live')
    expect(status).toBe('playing')
  })
})
