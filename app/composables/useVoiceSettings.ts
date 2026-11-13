import { type CameraResolution, isCameraResolution, DEFAULT_SCREEN_QUALITY, isScreenQuality, type SavedDevice, type ScreenQuality } from '#shared/utils/voice'
import { playMediaAudio } from '~/utils/media-audio'

type NoiseMode = 'off' | 'standard' | 'enhanced'
export type VoiceSound = 'join' | 'leave' | 'mute' | 'deafen' | 'camera' | 'screen' | 'watch'
export interface VoiceSettings {
  mic?: SavedDevice
  speaker?: SavedDevice
  mediaSpeaker?: SavedDevice
  camera?: SavedDevice
  cameraResolution: CameraResolution
  noise: NoiseMode
  echo: boolean
  agc: boolean
  /** 0–100, higher hears quieter speech. */
  sensitivity: number
  outputVolume: number
  radioVolume: number
  sounds: Record<VoiceSound, { on: boolean; volume: number }>
  /** Soundboard sounds from others: its own switch and volume. */
  soundboard: { on: boolean; volume: number }
  /** Apply live; enabling audio may reopen the browser picker when permission is missing. */
  screenAudio: boolean
  /** Apply live by briefly republishing screen video, retaining its capture. */
  screenQuality: ScreenQuality
}

export const useVoiceSettings = () =>
  useLocalStorage<VoiceSettings>(
    'spk:voice',
    {
      cameraResolution: 'auto',
      noise: 'enhanced',
      echo: true,
      agc: true,
      sensitivity: 50,
      outputVolume: 1,
      radioVolume: 0.1,
      screenAudio: true,
      screenQuality: DEFAULT_SCREEN_QUALITY,
      soundboard: { on: true, volume: 0.7 },
      sounds: {
        join: { on: true, volume: 0.5 },
        leave: { on: true, volume: 0.5 },
        mute: { on: true, volume: 0.5 },
        deafen: { on: true, volume: 0.5 },
        camera: { on: true, volume: 0.5 },
        screen: { on: true, volume: 0.5 },
        watch: { on: true, volume: 0.5 },
      },
    },
    {
      // An old 'eco' | 'smooth' string is replaced by the default.
      mergeDefaults: (stored, defaults) => ({
        ...defaults,
        ...stored,
        cameraResolution: isCameraResolution(stored.cameraResolution) ? stored.cameraResolution : defaults.cameraResolution,
        screenQuality: isScreenQuality(stored.screenQuality) ? stored.screenQuality : defaults.screenQuality,
        sounds: { ...defaults.sounds, ...stored.sounds },
      }),
    },
  )

// Notes and waveform per sound, synthesized so no files are needed. `up` = joining / unmuting, otherwise leaving / muting.
// Each kind differs in pitch, length or waveform, and none matches the message blip (660, 880).
const NOTES: Record<VoiceSound, { up: number[]; down: number[]; type?: OscillatorType }> = {
  join: { up: [523, 784], down: [784, 523] },
  leave: { up: [784, 523], down: [784, 523] },
  mute: { up: [330, 415], down: [415, 262], type: 'triangle' },
  deafen: { up: [262, 330, 392], down: [392, 294, 196], type: 'triangle' },
  camera: { up: [494, 622, 740], down: [740, 622, 494] },
  screen: { up: [349, 523, 698], down: [698, 523, 349], type: 'square' },
  watch: { up: [466, 622], down: [622, 466], type: 'sawtooth' },
}

/** Plays one of the voice sounds at its own volume, if enabled. `up` picks the rising variant (unmute, undeafen). */
export function playVoiceSound(kind: VoiceSound, up = true, force = false) {
  const { on, volume } = useVoiceSettings().value.sounds[kind]
  if ((!on && !force) || !import.meta.client) return
  void playMediaAudio((audio, destination) => {
    const t = audio.currentTime
    const { type = 'sine', ...notes } = NOTES[kind]
    // Harsher waveforms are quieter to stay soft.
    const gain = type === 'sine' || type === 'triangle' ? 0.3 : 0.12
    for (const [i, f] of notes[up ? 'up' : 'down'].entries()) {
      const o = audio.createOscillator(),
        g = audio.createGain()
      o.type = type
      o.frequency.value = f
      g.gain.setValueAtTime(gain * volume, t + i * 0.08)
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.12)
      o.connect(g).connect(destination)
      o.start(t + i * 0.08)
      o.stop(t + i * 0.08 + 0.13)
    }
  })
}
