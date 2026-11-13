import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeMediaAudio, getMediaAudio, playMediaAudio, setMediaAudioOutput } from '~/utils/media-audio'

const stop = vi.fn()
const stream = { getTracks: () => [{ stop }] }
const destination = { stream }
const defaultDestination = {}
const resume = vi.fn(async () => {})
const close = vi.fn(async () => {})
const createMediaStreamDestination = vi.fn(() => destination)
const play = vi.fn(async () => {})
const pause = vi.fn()
let elements: Array<{ srcObject: unknown; setSinkId: ReturnType<typeof vi.fn> }>
let contexts: number

beforeEach(() => {
  vi.clearAllMocks()
  resume.mockResolvedValue(undefined)
  play.mockResolvedValue(undefined)
  contexts = 0
  elements = []
  vi.stubGlobal(
    'AudioContext',
    class {
      destination = defaultDestination
      resume = resume
      close = close
      createMediaStreamDestination = createMediaStreamDestination
      constructor() {
        contexts++
      }
    },
  )
  vi.stubGlobal(
    'Audio',
    class {
      srcObject: unknown = null
      setSinkId = vi.fn(async (_id: string) => {})
      play = play
      pause = pause
      constructor() {
        elements.push(this)
      }
    },
  )
  setMediaAudioOutput('media')
})

afterEach(() => {
  closeMediaAudio()
  vi.unstubAllGlobals()
})

describe('shared media audio', () => {
  it('creates one context lazily and plays through the selected element, never the default destination', async () => {
    expect(contexts).toBe(0)
    const first = vi.fn(),
      second = vi.fn()
    void playMediaAudio(first)
    void playMediaAudio(second)
    await vi.waitFor(() => expect(second).toHaveBeenCalled())
    expect(contexts).toBe(1)
    expect(elements).toHaveLength(1)
    expect(elements[0]!.srcObject).toBe(stream)
    expect(elements[0]!.setSinkId).toHaveBeenCalledWith('media')
    expect(first).toHaveBeenCalledWith(getMediaAudio().context, destination)
    expect(second).toHaveBeenCalledWith(getMediaAudio().context, destination)
    expect(first).not.toHaveBeenCalledWith(expect.anything(), defaultDestination)
    setMediaAudioOutput('other')
    await vi.waitFor(() => expect(elements[0]!.setSinkId).toHaveBeenLastCalledWith('other'))
    expect(contexts).toBe(1)
    expect(pause).not.toHaveBeenCalled()
  })

  it('waits for pending routing before scheduling short sounds', async () => {
    await getMediaAudio().routing
    let finish!: () => void
    elements[0]!.setSinkId.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    setMediaAudioOutput('other')
    const sound = vi.fn()
    void playMediaAudio(sound)
    await Promise.resolve()
    expect(sound).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(sound).toHaveBeenCalled())
  })

  it('plays directly through the default destination when element routing is unsupported', async () => {
    vi.stubGlobal(
      'Audio',
      class {
        srcObject = null
      },
    )
    const sound = vi.fn()
    void playMediaAudio(sound)
    await vi.waitFor(() => expect(sound).toHaveBeenCalled())
    expect(sound).toHaveBeenCalledWith(getMediaAudio().context, defaultDestination)
    expect(createMediaStreamDestination).not.toHaveBeenCalled()
  })

  it('handles blocked autoplay and retries on the next sound', async () => {
    play.mockRejectedValueOnce(new Error('Autoplay blocked'))
    const sound = vi.fn()
    void playMediaAudio(sound)
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1))
    expect(sound).not.toHaveBeenCalled()
    void playMediaAudio(sound)
    await vi.waitFor(() => expect(sound).toHaveBeenCalledTimes(1))
  })

  it('releases the stream and context and cancels sounds pending at disposal', async () => {
    let finish!: () => void
    resume.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const sound = vi.fn()
    void playMediaAudio(sound)
    closeMediaAudio()
    finish()
    await vi.waitFor(() => expect(close).toHaveBeenCalled())
    expect(sound).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledOnce()
    expect(elements[0]!.srcObject).toBeNull()
  })
})
