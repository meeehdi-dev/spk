import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

import { loadRnnoise, NoiseGateWorkletNode, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import noiseGateWorklet from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url&no-inline'
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasm from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import rnnoiseWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url&no-inline'

export interface MicProcessing { enhanced: boolean, thresholdDb: number }

const modules = new WeakMap<AudioContext, Promise<unknown>>()
const addWorklets = (ctx: AudioContext) => {
  if (!modules.has(ctx)) modules.set(ctx, Promise.all([ctx.audioWorklet.addModule(noiseGateWorklet), ctx.audioWorklet.addModule(rnnoiseWorklet)]))
  return modules.get(ctx)!
}
let wasm: Promise<ArrayBuffer> | undefined
const loadWasm = () => wasm ??= loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm })

/**
 * LiveKit mic processor: mic → [RNNoise when "Enhanced"] → noise gate (voice activation, the sensitivity slider) → one stable output track.
 * The output track never changes when settings do, only the nodes between, so nothing is renegotiated.
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'spk-mic'
  processedTrack?: MediaStreamTrack
  private ctx?: AudioContext
  private src?: MediaStreamAudioSourceNode
  private dest?: MediaStreamAudioDestinationNode
  private chain: AudioNode[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private cfg: MicProcessing) {}

  async init(opts: AudioProcessorOptions) {
    this.ctx = opts.audioContext
    this.src = this.ctx.createMediaStreamSource(new MediaStream([opts.track]))
    this.dest = this.ctx.createMediaStreamDestination()
    this.processedTrack = this.dest.stream.getAudioTracks()[0]
    await this.update(this.cfg)
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy()
    await this.init(opts)
  }

  /** Rebuilds the nodes between source and output (serialized, so quick slider moves can't interleave). */
  update(cfg: MicProcessing) {
    this.cfg = cfg
    return this.queue = this.queue.then(() => this.build()).catch(() => {})
  }

  private async build() {
    const { ctx, src, dest } = this
    if (!ctx || !src || !dest) return
    await addWorklets(ctx)
    const next: AudioNode[] = []
    if (this.cfg.enhanced) next.push(new RnnoiseWorkletNode(ctx, { maxChannels: 2, wasmBinary: await loadWasm() }))
    next.push(new NoiseGateWorkletNode(ctx, { openThreshold: this.cfg.thresholdDb, holdMs: 300, maxChannels: 2 }))
    this.dispose()
    this.chain = next
    ;[src, ...next, dest].reduce((a, b) => (a.connect(b), b))
  }

  private dispose() {
    this.src?.disconnect()
    for (const n of this.chain) {
      n.disconnect();
      (n as { destroy?: () => void }).destroy?.()
    }
    this.chain = []
  }

  async destroy() {
    await this.queue
    this.dispose()
    this.processedTrack?.stop()
    this.src = this.dest = this.processedTrack = undefined
  }
}
