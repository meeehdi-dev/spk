import type { AudioProcessorOptions } from 'livekit-client'

import { createDeepFilterNetAudioWorklet } from '@workadventure/noise-suppression/deepfilternet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MicProcessor } from '~/utils/voice-processor'

vi.mock('@workadventure/noise-suppression/deepfilternet', () => ({
  DEEPFILTERNET_SAMPLE_RATE: 48_000,
  createDeepFilterNetAudioWorklet: vi.fn(),
}))

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
let contexts: FakeContext[]
let initialContextState: string
let processors: MicProcessor[]
const toast = vi.fn()
const load = vi.mocked(createDeepFilterNetAudioWorklet)

class FakeContext {
  state = initialContextState
  onstatechange: (() => void) | null = null
  audioWorklet = { addModule: vi.fn(async () => {}) }
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  sources: ReturnType<typeof node>[] = []
  output = { stop: vi.fn() }
  createMediaStreamSource = vi.fn(() => {
    const source = node()
    this.sources.push(source)
    return source
  })
  destination = { ...node(), stream: { getAudioTracks: () => [this.output] } }
  createMediaStreamDestination = vi.fn(() => this.destination)
  constructor(public options: AudioContextOptions) {
    contexts.push(this)
  }
}

const opts = { track: {} as MediaStreamTrack } as AudioProcessorOptions
const settings = { enhanced: true, thresholdDb: -50 }
const makeProcessor = (enhanced = false, onAudioBlocked?: (blocked: boolean) => void) => {
  const processor = new MicProcessor({ ...settings, enhanced }, onAudioBlocked)
  processors.push(processor)
  return processor
}
const handle = () => ({ node: node(), ready: Promise.resolve(480), dispose: vi.fn() })
const overload = () => load.mock.calls.at(-1)![1]!.onOverload!(1)

beforeEach(() => {
  vi.clearAllMocks()
  load.mockReset()
  contexts = []
  initialContextState = 'running'
  processors = []
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(public tracks: MediaStreamTrack[]) {}
    },
  )
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      parameters = new Map([['threshold', { value: 0 }]])
      connect = vi.fn()
    },
  )
  vi.stubGlobal('useToast', () => ({ add: toast }))
})

afterEach(async () => {
  await Promise.all(processors.map(processor => processor.destroy()))
  vi.unstubAllGlobals()
})

describe('MicProcessor', () => {
  it('never creates a context when the SDK initializes after cancellation', async () => {
    const attempt = new AbortController()
    const processor = new MicProcessor(settings, undefined, attempt.signal)
    processors.push(processor)
    attempt.abort()
    await processor.destroy()
    await expect(processor.init(opts)).rejects.toMatchObject({ name: 'AbortError' })
    expect(contexts).toHaveLength(0)
    expect(load).not.toHaveBeenCalled()
  })

  it('bypasses an overloaded model once and never reloads it for this processor', async () => {
    const dfn = handle()
    load.mockResolvedValue(dfn as unknown as Awaited<ReturnType<typeof createDeepFilterNetAudioWorklet>>)
    const processor = makeProcessor(true)
    await processor.init(opts)
    await Promise.resolve()
    const ctx = contexts[0]!
    const output = processor.processedTrack
    const gate = ctx.sources[0]!.connect.mock.calls[0]![0]
    overload()
    overload()
    expect(dfn.dispose).toHaveBeenCalledOnce()
    expect(ctx.sources[0]!.connect).toHaveBeenLastCalledWith(gate)
    expect(toast).toHaveBeenCalledOnce()
    processor.update({ ...settings, thresholdDb: -40 })
    processor.update({ ...settings, enhanced: false })
    processor.update(settings)
    await processor.restart(opts)
    expect(load).toHaveBeenCalledOnce()
    expect(processor.processedTrack).toBe(output)
    expect(settings.enhanced).toBe(true)
    expect(ctx.options.sampleRate).toBe(48_000)
  })

  it('ignores readiness failure after overload and allows a fresh processor to load', async () => {
    const ready = deferred<number>()
    const dfn = { ...handle(), ready: ready.promise }
    load.mockResolvedValue(dfn as unknown as Awaited<ReturnType<typeof createDeepFilterNetAudioWorklet>>)
    const processor = makeProcessor(true)
    await processor.init(opts)
    await Promise.resolve()
    overload()
    ready.reject(new Error('disposed'))
    await Promise.resolve()
    expect(toast).toHaveBeenCalledOnce()
    expect(dfn.dispose).toHaveBeenCalledOnce()
    load.mockResolvedValue(handle() as unknown as Awaited<ReturnType<typeof createDeepFilterNetAudioWorklet>>)
    await makeProcessor(true).init(opts)
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(2)
    overload()
    expect(toast).toHaveBeenCalledTimes(2)
  })

  it('disposes a model returned after overload without connecting it', async () => {
    const pending = deferred<Awaited<ReturnType<typeof createDeepFilterNetAudioWorklet>>>()
    load.mockReturnValue(pending.promise)
    const processor = makeProcessor(true)
    await processor.init(opts)
    overload()
    const dfn = handle()
    pending.resolve(dfn as unknown as Awaited<ReturnType<typeof createDeepFilterNetAudioWorklet>>)
    await Promise.resolve()
    expect(dfn.dispose).toHaveBeenCalledOnce()
    expect(dfn.node.connect).not.toHaveBeenCalled()
    processor.update(settings)
    expect(load).toHaveBeenCalledOnce()
  })

  it.each(['disable', 'destroy'] as const)('ignores stale overload and load completion after %s', async action => {
    const pending = deferred<Awaited<ReturnType<typeof createDeepFilterNetAudioWorklet>>>()
    load.mockReturnValue(pending.promise)
    const processor = makeProcessor(true)
    await processor.init(opts)
    if (action === 'destroy') await processor.destroy()
    else processor.update({ ...settings, enhanced: false })
    overload()
    const dfn = handle()
    pending.resolve(dfn as unknown as Awaited<ReturnType<typeof createDeepFilterNetAudioWorklet>>)
    await Promise.resolve()
    expect(dfn.dispose).toHaveBeenCalledOnce()
    expect(dfn.node.connect).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('reports blocked immediately when created suspended, even while resume hangs', async () => {
    initialContextState = 'suspended'
    const blocked = vi.fn()
    const processor = makeProcessor(false, blocked)
    const init = processor.init(opts)
    const ctx = contexts[0]!
    expect(blocked.mock.calls).toEqual([[true]])
    const pending = deferred()
    ctx.resume.mockReturnValueOnce(pending.promise)
    await Promise.resolve()
    expect(ctx.resume).toHaveBeenCalledOnce()
    expect(blocked.mock.calls).toEqual([[true]])
    ctx.state = 'running'
    ctx.onstatechange?.()
    expect(blocked.mock.calls).toEqual([[true], [false]])
    pending.resolve()
    await init
  })

  it.each(['suspended', 'interrupted'])('reports later %s and recovery, but not closed as blocked', async state => {
    const blocked = vi.fn()
    const processor = makeProcessor(false, blocked)
    await processor.init(opts)
    const ctx = contexts[0]!
    expect(blocked.mock.calls).toEqual([[false]])
    ctx.state = state
    ctx.onstatechange?.()
    ctx.state = 'running'
    ctx.onstatechange?.()
    ctx.state = 'closed'
    ctx.onstatechange?.()
    expect(blocked.mock.calls).toEqual([[false], [true], [false], [false]])
  })

  it('clears the blocked signal on destroy and ignores stale context events', async () => {
    const blocked = vi.fn()
    const processor = makeProcessor(false, blocked)
    await processor.init(opts)
    const ctx = contexts[0]!
    const stale = ctx.onstatechange!
    ctx.state = 'suspended'
    stale()
    await processor.destroy()
    expect(ctx.onstatechange).toBeNull()
    expect(blocked.mock.calls).toEqual([[false], [true], [false]])
    blocked.mockClear()
    ctx.state = 'interrupted'
    stale()
    await processor.destroy()
    expect(blocked).not.toHaveBeenCalled()
    await processor.init(opts)
    blocked.mockClear()
    stale()
    expect(blocked).not.toHaveBeenCalled()
  })

  it('resumes synchronously from a gesture while init is waiting for resume', async () => {
    const processor = makeProcessor()
    const init = processor.init(opts)
    const ctx = contexts[0]!
    const pending = deferred()
    ctx.state = 'suspended'
    ctx.resume.mockReturnValueOnce(pending.promise)
    await Promise.resolve()
    expect(ctx.resume).toHaveBeenCalledOnce()
    const recovery = processor.resume()
    expect(ctx.resume).toHaveBeenCalledTimes(2)
    await recovery
    pending.resolve()
    await init
    expect(processor.processedTrack).toBe(ctx.output)
  })

  it('checks interrupted context on restart and preserves the output', async () => {
    const processor = makeProcessor()
    await processor.init(opts)
    const ctx = contexts[0]!
    ctx.state = 'interrupted'
    const output = processor.processedTrack
    const restart = processor.restart(opts)
    expect(ctx.resume).toHaveBeenCalledOnce()
    await restart
    expect(ctx.sources).toHaveLength(2)
    expect(processor.processedTrack).toBe(output)
    expect(contexts).toHaveLength(1)
  })

  it.each(['init', 'restart'] as const)('does not recreate nodes after destroy during %s recovery', async action => {
    const processor = makeProcessor()
    let operation: Promise<void>
    if (action === 'restart') await processor.init(opts)
    else operation = processor.init(opts)
    const ctx = contexts[0]!
    const pending = deferred()
    ctx.state = 'suspended'
    ctx.resume.mockReturnValueOnce(pending.promise)
    if (action === 'restart') operation = processor.restart(opts)
    await Promise.resolve()
    const sources = ctx.sources.length
    await processor.destroy()
    pending.resolve()
    await operation!
    expect(ctx.sources).toHaveLength(sources)
    expect(processor.processedTrack).toBeUndefined()
    expect(ctx.close).toHaveBeenCalledOnce()
    await processor.resume()
    expect(ctx.resume).toHaveBeenCalledOnce()
  })

  it('cleans up after initialization failure', async () => {
    const processor = makeProcessor()
    const init = processor.init(opts)
    const ctx = contexts[0]!
    ctx.state = 'suspended'
    ctx.resume.mockRejectedValueOnce(new Error('resume failed'))
    await expect(init).rejects.toThrow('resume failed')
    expect(ctx.close).toHaveBeenCalledOnce()
    expect(processor.processedTrack).toBeUndefined()
  })

  it('does not initialize after destroy during gate module loading', async () => {
    const processor = makeProcessor()
    const init = processor.init(opts)
    const ctx = contexts[0]!
    await processor.destroy()
    await init
    expect(ctx.createMediaStreamSource).not.toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalledOnce()
  })
})
