export type RadioPlayback = 'idle' | 'loading' | 'playing' | 'blocked' | 'error'

/** CORS playback can be amplified; incompatible stations retry on a fresh, ordinary element. */
export function createRadioPlayer(status: (value: RadioPlayback) => void, boosting: (available: boolean | null) => void = () => {}) {
  let audio: HTMLAudioElement | undefined
  let graph:
    | { context: AudioContext; gain: GainNode; source: MediaElementAudioSourceNode; destination: MediaStreamAudioDestinationNode; output: HTMLAudioElement }
    | undefined
  let volume = 1
  let muted = false
  let sink = ''
  let timeout: ReturnType<typeof setTimeout> | undefined

  function stop() {
    clearTimeout(timeout)
    timeout = undefined
    const old = audio
    audio = undefined
    if (old) {
      old.onplaying = old.onerror = old.onended = null
      old.pause()
      old.removeAttribute('src')
      old.load()
    }
    const previous = graph
    graph = undefined
    if (previous) {
      previous.output.pause()
      previous.output.srcObject = null
      previous.source.disconnect()
      previous.gain.disconnect()
      previous.destination.stream.getTracks().forEach(track => track.stop())
      void previous.context.close().catch(() => {})
    }
    boosting(null)
    status('idle')
  }

  async function routeOutput() {
    const target = graph?.output ?? audio
    const desired = sink
    if (!target || !('setSinkId' in target)) return
    try {
      await target.setSinkId(desired)
    } catch {
      if (target === (graph?.output ?? audio) && desired === sink) await target.setSinkId('').catch(() => {})
    }
    if (target === (graph?.output ?? audio) && desired !== sink) void routeOutput()
  }

  function applyOutput() {
    if (!audio) return
    audio.volume = graph ? 1 : Math.min(1, volume)
    audio.muted = muted
    if (graph) graph.gain.gain.value = muted ? 0 : volume
  }

  async function start(url: string, cors = true): Promise<void> {
    stop()
    if (cors && typeof AudioContext === 'undefined') return start(url, false)
    const target = new Audio()
    audio = target
    target.preload = 'none'
    if (cors) {
      let context: AudioContext | undefined
      try {
        context = new AudioContext()
        const gain = context.createGain()
        const destination = context.createMediaStreamDestination()
        const output = new Audio()
        output.srcObject = destination.stream
        target.crossOrigin = 'anonymous'
        const source = context.createMediaElementSource(target)
        source.connect(gain).connect(destination)
        graph = { context, gain, source, destination, output }
      } catch {
        if (context) void context.close().catch(() => {})
        return start(url, false)
      }
    }
    applyOutput()
    let sourcePlaying = false
    let outputReady = false
    const reportPlaying = () => {
      if (audio === target && sourcePlaying && outputReady) {
        clearTimeout(timeout)
        boosting(cors)
        status('playing')
      }
    }
    target.onplaying = () => {
      sourcePlaying = true
      reportPlaying()
    }
    const fail = () => {
      if (audio !== target) return
      if (cors) void start(url, false)
      else {
        stop()
        status('error')
      }
    }
    target.onerror = target.onended = fail
    timeout = setTimeout(fail, 15_000)
    status('loading')
    target.src = url
    void routeOutput()
    try {
      // Keep all autoplay-sensitive calls in the original activation, including the routed output.
      await Promise.all([target.play(), graph?.context.resume(), graph?.output.play()])
      if (audio !== target) return
      if (graph && graph.context.state !== 'running') throw new DOMException('Audio context is suspended', 'NotAllowedError')
      outputReady = true
      reportPlaying()
    } catch (e) {
      if (audio !== target) return
      if ((e as Error).name !== 'NotAllowedError' && cors) return start(url, false)
      stop()
      status((e as Error).name === 'NotAllowedError' ? 'blocked' : 'error')
    }
  }

  return {
    start: (url: string) => start(url),
    stop,
    output(level: number, silent: boolean, device: string) {
      volume = Math.max(0, Math.min(4, Number.isFinite(level) ? level : 0))
      muted = silent
      const changed = sink !== device
      sink = device
      applyOutput()
      if (audio && changed) void routeOutput()
    },
  }
}
