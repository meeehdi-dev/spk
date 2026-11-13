import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRadioPlayer, type RadioPlayback } from '~/utils/radio-player'

class AudioMock {
  src = ''
  volume = 1
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
  vi.unstubAllGlobals()
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
