import { routeMediaOutput } from '~/utils/media-output'

let device = ''
let audio:
  | {
      context: AudioContext
      destination: AudioNode
      element?: HTMLAudioElement
      routing: Promise<void>
    }
  | undefined

/** One lazy context for soundboard sounds, voice actions and message blips. */
export function getMediaAudio() {
  if (!audio) {
    const context = new AudioContext()
    const element = new Audio()
    if ('setSinkId' in element) {
      // Some browsers support element routing but not AudioContext.setSinkId.
      const destination = context.createMediaStreamDestination()
      element.srcObject = destination.stream
      audio = { context, destination, element, routing: routeMediaOutput(element, device) }
    } else {
      audio = { context, destination: context.destination, routing: Promise.resolve() }
    }
  }
  return audio
}

export function setMediaAudioOutput(id: string) {
  device = id
  if (audio?.element) audio.routing = routeMediaOutput(audio.element, id)
}

export async function playMediaAudio(play: (context: AudioContext, destination: AudioNode) => void) {
  if (!import.meta.client) return
  try {
    const current = getMediaAudio()
    // Start both while user activation is available; schedule sounds after routing is ready.
    await Promise.all([current.context.resume(), current.element?.play(), current.routing])
    if (audio === current) play(current.context, current.destination)
  } catch {
    /* autoplay policy or missing audio support: stay silent */
  }
}

export function closeMediaAudio() {
  const old = audio
  audio = undefined
  if (old?.element) {
    old.element.pause()
    ;(old.element.srcObject as MediaStream).getTracks().forEach(track => track.stop())
    old.element.srcObject = null
  }
  if (old) void old.context.close().catch(() => {})
}
