import type { SavedDevice } from '#shared/utils/voice'

type NoiseMode = 'off' | 'standard' | 'enhanced'
export type VoiceSound = 'join' | 'leave' | 'mute' | 'deafen' | 'camera' | 'screen'
export interface VoiceSettings {
  mic?: SavedDevice, speaker?: SavedDevice, camera?: SavedDevice
  noise: NoiseMode, echo: boolean, agc: boolean
  /** 0–100, higher hears quieter speech. */
  sensitivity: number, outputVolume: number
  sounds: Record<VoiceSound, { on: boolean, volume: number }>
  /** Soundboard sounds from others: its own switch and volume. */
  soundboard: { on: boolean, volume: number }
  /** Share audio with the screen (the chevron next to the share button). */
  screenAudio: boolean
}

export const useVoiceSettings = () => useLocalStorage<VoiceSettings>('spk:voice', {
  noise: 'standard', echo: true, agc: true, sensitivity: 50, outputVolume: 1, screenAudio: true, soundboard: { on: true, volume: 0.7 },
  sounds: { join: { on: true, volume: 0.5 }, leave: { on: true, volume: 0.5 }, mute: { on: true, volume: 0.5 }, deafen: { on: true, volume: 0.5 }, camera: { on: true, volume: 0.5 }, screen: { on: true, volume: 0.5 } }
}, { mergeDefaults: (stored, defaults) => ({ ...defaults, ...stored, sounds: { ...defaults.sounds, ...stored.sounds } }) })

let audio: AudioContext | undefined
// Notes per sound, synthesized so no files are needed. `up` = joining / unmuting, otherwise leaving / muting.
const NOTES: Record<VoiceSound, { up: number[], down: number[] }> = {
  join: { up: [523, 784], down: [784, 523] },
  leave: { up: [784, 523], down: [784, 523] },
  mute: { up: [660, 880], down: [440, 330] },
  deafen: { up: [660, 880, 990], down: [440, 330, 247] },
  camera: { up: [440, 587, 740], down: [740, 587, 440] },
  screen: { up: [349, 523, 698], down: [698, 523, 349] }
}

/** Plays one of the voice sounds at its own volume, if enabled. `up` picks the rising variant (unmute, undeafen). */
export function playVoiceSound(kind: VoiceSound, up = true, force = false) {
  const { on, volume } = useVoiceSettings().value.sounds[kind]
  if ((!on && !force) || !import.meta.client) return
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    for (const [i, f] of NOTES[kind][up ? 'up' : 'down'].entries()) {
      const o = audio.createOscillator(), g = audio.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.3 * volume, t + i * 0.08)
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.12)
      o.connect(g).connect(audio.destination)
      o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.13)
    }
  } catch { /* autoplay policy: stay silent */ }
}
