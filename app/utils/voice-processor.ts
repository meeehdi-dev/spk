import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

import {
  createDeepFilterNetAudioWorklet,
  DEEPFILTERNET_SAMPLE_RATE,
  type DeepFilterNetAudioWorkletHandle,
} from '@workadventure/noise-suppression/deepfilternet'

export interface MicProcessing {
  enhanced: boolean
  thresholdDb: number
}

// Voice-activation gate: opens above `threshold` dBFS (RMS per block), stays open 300 ms, fades 5 ms in / 50 ms out.
const gateSource = `class Gate extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'threshold', defaultValue: -50 }] }
  open = false; hold = 0; gain = 0
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0]
    if (!input.length) return true
    const n = input[0].length
    let sum = 0
    for (const ch of input) for (let i = 0; i < n; i++) sum += ch[i] * ch[i]
    if (10 * Math.log10(sum / (n * input.length) + 1e-12) >= params.threshold[0]) { this.open = true; this.hold = 0.3 * sampleRate }
    else if (this.open && (this.hold -= n) <= 0) this.open = false
    const target = this.open ? 1 : 0, step = 1 / ((target ? 0.005 : 0.05) * sampleRate)
    for (let i = 0; i < n; i++) {
      this.gain += Math.max(-step, Math.min(step, target - this.gain))
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ?? input[0])[i] * this.gain
    }
    return true
  }
}
registerProcessor('spk-gate', Gate)`

let warned = false

/**
 * LiveKit mic processor: mic → [DeepFilterNet3 when "Enhanced"] → voice-activation gate (the sensitivity slider) → one stable output track.
 * Runs in its own 48 kHz AudioContext (DeepFilterNet3 needs it). The output track never changes when settings do,
 * only the DeepFilterNet3 node comes and goes, so nothing is renegotiated. The mic is live (unfiltered, gated) while the model loads.
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'spk-mic'
  processedTrack?: MediaStreamTrack
  private ctx?: AudioContext
  private src?: MediaStreamAudioSourceNode
  private gate?: AudioWorkletNode
  private dest?: MediaStreamAudioDestinationNode
  private dfn?: DeepFilterNetAudioWorkletHandle
  private token = 0 // bumped to cancel a pending model load
  private pending = 0 // token of the load in flight, 0 = none

  constructor(private cfg: MicProcessing) {}

  async init(opts: AudioProcessorOptions) {
    const ctx = (this.ctx = new AudioContext({ sampleRate: DEEPFILTERNET_SAMPLE_RATE, latencyHint: 'interactive' }))
    const url = URL.createObjectURL(new Blob([gateSource], { type: 'text/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    if (ctx.state === 'suspended') await ctx.resume()
    this.src = ctx.createMediaStreamSource(new MediaStream([opts.track]))
    this.gate = new AudioWorkletNode(ctx, 'spk-gate')
    this.dest = ctx.createMediaStreamDestination()
    this.src.connect(this.gate)
    this.gate.connect(this.dest)
    this.processedTrack = this.dest.stream.getAudioTracks()[0]
    this.update(this.cfg) // not awaited: join must not wait for the model download
  }

  /** LiveKit restarts after a setting change or device switch: only the source node is swapped, the rest of the chain stays. */
  async restart(opts: AudioProcessorOptions) {
    if (!this.ctx || !this.src) return this.init(opts)
    this.src.disconnect()
    this.src = this.ctx.createMediaStreamSource(new MediaStream([opts.track]))
    this.src.connect(this.dfn?.node ?? this.gate!)
  }

  /** Applies settings. A slider move only sets the gate threshold: the model isn't reloaded. */
  update(cfg: MicProcessing) {
    this.cfg = cfg
    if (!this.ctx || !this.gate) return
    this.gate.parameters.get('threshold')!.value = cfg.thresholdDb
    if (!cfg.enhanced) {
      this.token++
      this.pending = 0
      if (this.dfn) this.removeDfn()
    } else if (!this.dfn && !this.pending) void this.load(this.ctx, this.gate)
  }

  private async load(ctx: AudioContext, gate: AudioWorkletNode) {
    const mine = (this.pending = ++this.token)
    const live = () => this.token === mine
    let dfn: DeepFilterNetAudioWorkletHandle | undefined
    try {
      dfn = await createDeepFilterNetAudioWorklet(ctx) // package defaults; passes the mic through while loading
      if (!live()) return dfn.dispose()
      this.dfn = dfn
      this.src!.disconnect()
      this.src!.connect(dfn.node)
      dfn.node.connect(gate)
      await dfn.ready
    } catch {
      if (!live()) return
      if (dfn) this.removeDfn()
      if (!warned) {
        warned = true
        useToast().add({ title: "Enhanced noise suppression couldn't load", icon: 'i-lucide-triangle-alert', color: 'warning' })
      }
    } finally {
      if (live()) this.pending = 0
    }
  }

  /** Drops the DeepFilterNet3 node and sends the mic straight to the gate. */
  private removeDfn() {
    const dfn = this.dfn!
    this.dfn = undefined
    this.src?.disconnect()
    this.src?.connect(this.gate!)
    dfn.node.disconnect()
    dfn.dispose()
  }

  async destroy() {
    this.token++
    this.pending = 0
    this.dfn?.dispose()
    this.dfn = undefined
    this.processedTrack?.stop()
    this.src?.disconnect()
    await this.ctx?.close()
    this.ctx = this.src = this.gate = this.dest = this.processedTrack = undefined
  }
}
