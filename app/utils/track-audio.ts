import type { RemoteAudioTrack } from 'livekit-client'

/** Boost only when needed; keep each SDK element (and its independent output device). */
export function createTrackAudio(blocked: () => void) {
  let context: AudioContext | undefined
  const graphs = new Map<
    RemoteAudioTrack,
    { source: MediaStreamAudioSourceNode; gain: GainNode; destination: MediaStreamAudioDestinationNode; native: MediaStreamTrack; keeper: HTMLAudioElement }
  >()

  function keep(keeper: HTMLAudioElement, native: MediaStreamTrack) {
    keeper.srcObject = new MediaStream([native])
    void keeper.play().catch(() => {})
  }

  function wire(track: RemoteAudioTrack) {
    const graph = graphs.get(track)
    if (!graph) return
    for (const element of track.attachedElements) {
      if (element.srcObject === graph.destination.stream) continue
      element.srcObject = graph.destination.stream
      void element.play().catch(() => {
        if (graphs.get(track) === graph && element.srcObject === graph.destination.stream) blocked()
      })
    }
    track.setVolume(1)
  }

  return {
    volume(track: RemoteAudioTrack, volume: number) {
      if (volume > 1 && !graphs.has(track)) {
        if (!context) {
          const current = new AudioContext()
          context = current
          current.onstatechange = () => {
            if (context === current && graphs.size && current.state !== 'running') blocked()
          }
        }
        const source = context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]))
        const gain = context.createGain()
        const destination = context.createMediaStreamDestination()
        source.connect(gain).connect(destination)
        // Chromium bug 40094084: a remote WebRTC stream is silent in WebAudio unless attached to a media element.
        const keeper = new Audio()
        keeper.muted = true
        keep(keeper, track.mediaStreamTrack)
        graphs.set(track, { source, gain, destination, native: track.mediaStreamTrack, keeper })
        const current = context
        void current
          .resume()
          .then(() => {
            if (context === current && current.state !== 'running') blocked()
          })
          .catch(() => {
            if (context === current) blocked()
          })
      }
      const graph = graphs.get(track)
      if (!graph) {
        track.setVolume(volume)
        return
      }
      if (graph.native !== track.mediaStreamTrack) {
        graph.source.disconnect()
        graph.native = track.mediaStreamTrack
        graph.source = context!.createMediaStreamSource(new MediaStream([graph.native]))
        graph.source.connect(graph.gain)
        keep(graph.keeper, graph.native)
      }
      graph.gain.gain.value = volume
      wire(track)
    },
    attach(track: RemoteAudioTrack) {
      // SDK attach starts playback immediately: silence the raw stream until rewired.
      if (graphs.has(track)) track.setVolume(0)
      if (!track.attachedElements.some(element => element.isConnected)) document.body.append(track.attach())
      wire(track)
    },
    async resume() {
      if (context) {
        await context.resume()
        if (context.state !== 'running') throw new Error('Playback audio context is suspended')
      }
    },
    forget(track: RemoteAudioTrack) {
      const graph = graphs.get(track)
      if (!graph) return
      graph.source.disconnect()
      graph.gain.disconnect()
      graph.keeper.pause()
      graph.keeper.srcObject = null
      graph.destination.stream.getTracks().forEach(native => native.stop())
      graphs.delete(track)
    },
    close() {
      for (const track of graphs.keys()) this.forget(track)
      const old = context
      context = undefined
      if (old) {
        old.onstatechange = null
        void old.close().catch(() => {})
      }
    },
  }
}
