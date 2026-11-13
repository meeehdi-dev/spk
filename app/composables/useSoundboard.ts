import { MAX_SOUND_MS, SOUND_COOLDOWN_MS } from '#shared/utils/sounds'
import { getMediaAudio, playMediaAudio } from '~/utils/media-audio'

export interface SoundEntry {
  id: string
  name: string
  icon: string
  durationMs: number
}

export const useSounds = () => useFetch<SoundEntry[]>('/api/sounds', { key: 'sounds', headers: useRequestHeaders(['cookie']), default: () => [] })

const buffers = new Map<string, Promise<AudioBuffer>>() // decoded once per sound; a failure is dropped so it can be retried

function load(id: string) {
  let p = buffers.get(id)
  if (!p) {
    const { context } = getMediaAudio()
    p = $fetch<{ url: string }>(`/api/sounds/${id}/file`)
      .then(r => fetch(r.url))
      .then(r => r.arrayBuffer())
      .then(b => context.decodeAudioData(b))
    p.catch(() => buffers.delete(id))
    buffers.set(id, p)
  }
  return p
}
/** Forget a cached sound (it was deleted). */
export const forgetSound = (id: string) => buffers.delete(id)

/** Plays a sound locally through Web Audio at the soundboard volume, for at most 10 s. `force` ignores the off switch (previews). */
export async function playSound(id: string, force = false) {
  const { on, volume } = useVoiceSettings().value.soundboard
  if (!import.meta.client || (!on && !force)) return
  try {
    const { context: loadingContext } = getMediaAudio()
    const buf = await load(id)
    if (loadingContext.state === 'closed') return
    await playMediaAudio((context, destination) => {
      const src = context.createBufferSource(),
        gain = context.createGain()
      src.buffer = buf
      gain.gain.value = volume
      src.connect(gain).connect(destination)
      src.start(0, 0, Math.min(buf.duration, MAX_SOUND_MS / 1000))
    })
  } catch {
    /* autoplay policy or a missing file: stay silent */
  }
}

let lastSent = 0
/** Sends a sound to everyone in your voice channel (the server checks and relays it). Mirrors the server's 3 s cooldown so the button shows it. */
export function useSoundboard() {
  const v = useVoice()
  const socket = useSocket()
  const cooling = ref(false)
  function press(id: string) {
    if (!v.channelId.value || Date.now() - lastSent < SOUND_COOLDOWN_MS) return
    lastSent = Date.now()
    cooling.value = true
    setTimeout(() => {
      cooling.value = false
    }, SOUND_COOLDOWN_MS)
    socket.send({ type: 'voice:sound', sid: v.sid, soundId: id })
    void load(id).catch(() => {}) // warm the cache; the relay frame plays it
  }
  return { cooling, press }
}
