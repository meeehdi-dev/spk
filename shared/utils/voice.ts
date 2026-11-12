/** Pure voice logic (mute/deafen rules, device matching, sensitivity), kept free of browser APIs so it can be unit-tested. */

export interface MuteState {
  muted: boolean
  deafened: boolean
  /** mute state to restore when undeafening */ restore: boolean
}
export const initialMute = (): MuteState => ({ muted: false, deafened: false, restore: false })

/** Mic button: unmuting while deafened also undeafens you. */
export function toggleMute(s: MuteState): MuteState {
  if (s.deafened) return { muted: false, deafened: false, restore: false }
  return { ...s, muted: !s.muted }
}

/** Headphones button: deafening also mutes; undeafening restores the mute state from before. */
export function toggleDeafen(s: MuteState): MuteState {
  if (s.deafened) return { muted: s.restore, deafened: false, restore: false }
  return { muted: true, deafened: true, restore: s.muted }
}

export interface SavedDevice {
  deviceId: string
  label: string
}
export interface DeviceLike {
  deviceId: string
  label: string
}

/** Saved id first, then a device with the same label, otherwise the system default (`deviceId` undefined). */
export function matchDevice(saved: SavedDevice | undefined, devices: DeviceLike[]): { deviceId?: string; how: 'id' | 'label' | 'default' } {
  if (saved?.deviceId && devices.some(d => d.deviceId === saved.deviceId)) return { deviceId: saved.deviceId, how: 'id' }
  const byLabel = saved?.label ? devices.find(d => d.label === saved.label && d.deviceId) : undefined
  if (byLabel) return { deviceId: byLabel.deviceId, how: 'label' }
  return { how: 'default' }
}

/** Sensitivity 0–100 (higher hears quieter speech) → noise-gate threshold in dB. 50 → -50 dB. */
export const sensitivityToDb = (sensitivity: number) => -20 - Math.min(100, Math.max(0, sensitivity)) * 0.6

/** Screen share audio is never processed: no browser suppression/echo/gain and no DeepFilterNet (that applies to the mic track only). F11 passes this to LiveKit's screen share audio capture. */
export const SCREEN_AUDIO_CAPTURE = { noiseSuppression: false, echoCancellation: false, autoGainControl: false } as const

export const SCREEN_HEIGHTS = [720, 1080, 1440] as const
export const SCREEN_FPS = [5, 30, 60] as const
/** Max capture height (16:9 ceiling) and frame rate chosen in the screen share dialog. */
export interface ScreenQuality {
  height: (typeof SCREEN_HEIGHTS)[number]
  fps: (typeof SCREEN_FPS)[number]
}
export const DEFAULT_SCREEN_QUALITY: ScreenQuality = { height: 1080, fps: 30 }
export const isScreenQuality = (q: unknown): q is ScreenQuality =>
  !!q && typeof q === 'object' && SCREEN_HEIGHTS.includes((q as ScreenQuality).height) && SCREEN_FPS.includes((q as ScreenQuality).fps)

/** Capture constraints and publish options for a quality choice (PLAN §8). 5 fps is tuned for sharp text, 30/60 for motion. Single layer, never simulcast, never upscaled (`max`); VP9 with a VP8 backup. Bitrate scales with pixels × fps^0.674, anchored at 1440p5 ≈ 5 Mbps and 1080p60 ≈ 15 Mbps. */
export function screenShareOptions({ height, fps }: ScreenQuality) {
  const width = Math.round((height * 16) / 9)
  return {
    resolution: { width, height, frameRate: fps },
    codec: 'vp9',
    contentHint: fps === 5 ? 'detail' : 'motion',
    degradationPreference: fps === 5 ? 'maintain-resolution' : 'maintain-framerate',
    maxBitrate: Math.round((width * height * 0.458 * fps ** 0.674) / 100_000) * 100_000,
  } as const
}

/** Room-wide publish/capture defaults: one layer per track, 1080p30 camera at 6 Mbps, mic Opus 128 kbps without DTX (no comfort-noise gaps) and with RED. */
export const VOICE_PUBLISH_DEFAULTS = {
  simulcast: false,
  videoEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 },
  audioPreset: { maxBitrate: 128_000 },
  dtx: false,
  red: true,
} as const
export const CAMERA_CAPTURE = { resolution: { width: 1920, height: 1080, frameRate: 30 } } as const
/** Screen audio: stereo Opus 256 kbps, DTX off. */
export const SCREEN_AUDIO_PUBLISH = { audioPreset: { maxBitrate: 256_000 }, forceStereo: true, dtx: false } as const

export interface UserVolume {
  mic: number
  screen: number
  muted: boolean
}
export const userVolume = (all: Record<string, Partial<UserVolume>>, id: string): UserVolume => ({ mic: 1, screen: 1, muted: false, ...all[id] })

/** Playback volume (0–1) of one remote audio track: deafen and "mute for me" silence it, otherwise the per-user slider times the output volume. */
export const effectiveVolume = (deafened: boolean, v: UserVolume, kind: 'mic' | 'screen', output: number) =>
  deafened || v.muted ? 0 : Math.min(1, Math.max(0, v[kind])) * output
