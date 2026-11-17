import { MAX_SOUND_MS, SOUND_COOLDOWN_MS } from '#shared/utils/sounds'
import { routeMediaOutput } from '~/utils/media-output'

export interface SoundEntry {
  id: string
  name: string
  icon: string
  durationMs: number
}

export const useSounds = () => useFetch<SoundEntry[]>('/api/sounds', { key: 'sounds', headers: useRequestHeaders(['cookie']), default: () => [] })

const files = new Map<string, Promise<string>>() // cache file bytes, not expiring signed URLs
const players = new Map<HTMLAudioElement, { id: string; stop: () => void }>()
let output = ''

function load(id: string) {
  let p = files.get(id)
  if (!p) {
    p = $fetch<{ url: string }>(`/api/sounds/${id}/file`)
      .then(r => fetch(r.url))
      .then(r => {
        if (!r.ok) throw new Error(`Sound download failed (${r.status})`)
        return r.blob()
      })
      .then(blob => {
        if (files.get(id) !== p) throw new Error('Sound was discarded')
        return URL.createObjectURL(blob)
      })
    p.catch(() => {
      if (files.get(id) === p) files.delete(id)
    })
    files.set(id, p)
  }
  return p
}

/** Forget a deleted sound, including pending and active playback. */
export function forgetSound(id: string) {
  const file = files.get(id)
  files.delete(id)
  void file?.then(
    url => URL.revokeObjectURL(url),
    () => {},
  )
  for (const player of players.values()) if (player.id === id) player.stop()
}

export function setSoundboardOutput(id: string) {
  output = id
  for (const player of players.keys()) void routeMediaOutput(player, id)
}

export function closeSoundboardAudio() {
  for (const player of players.values()) player.stop()
  for (const id of files.keys()) forgetSound(id)
}

/** Direct local playback for at most 10 s. `force` ignores the off switch (previews). */
export async function playSound(id: string, force = false) {
  const { on, volume } = useVoiceSettings().value.soundboard
  if (!import.meta.client || (!on && !force)) return
  let stop: (() => void) | undefined
  try {
    const file = load(id)
    const url = await file
    if (files.get(id) !== file) return
    const player = new Audio(url)
    player.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.7
    let timer: ReturnType<typeof setTimeout> | undefined
    stop = () => {
      if (!players.delete(player)) return
      clearTimeout(timer)
      player.onended = null
      player.onerror = null
      player.ontimeupdate = null
      player.pause()
      player.removeAttribute('src')
      player.load()
    }
    const finish = stop
    players.set(player, { id, stop })
    player.onended = finish
    player.onerror = finish
    player.ontimeupdate = () => {
      if (player.currentTime >= MAX_SOUND_MS / 1000) finish()
    }
    await routeMediaOutput(player, output)
    if (!players.has(player)) return
    await player.play()
    if (players.has(player)) timer = setTimeout(finish, MAX_SOUND_MS)
  } catch {
    stop?.()
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
