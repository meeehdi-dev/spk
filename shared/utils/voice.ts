/** Pure voice logic (mute/deafen rules, device matching, sensitivity), kept free of browser APIs so it can be unit-tested. */

export interface MuteState { muted: boolean, deafened: boolean, /** mute state to restore when undeafening */ restore: boolean }
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

export interface SavedDevice { deviceId: string, label: string }
export interface DeviceLike { deviceId: string, label: string }

/** Saved id first, then a device with the same label, otherwise the system default (`deviceId` undefined). */
export function matchDevice(saved: SavedDevice | undefined, devices: DeviceLike[]): { deviceId?: string, how: 'id' | 'label' | 'default' } {
  if (saved?.deviceId && devices.some(d => d.deviceId === saved.deviceId)) return { deviceId: saved.deviceId, how: 'id' }
  const byLabel = saved?.label ? devices.find(d => d.label === saved.label && d.deviceId) : undefined
  if (byLabel) return { deviceId: byLabel.deviceId, how: 'label' }
  return { how: 'default' }
}

/** Sensitivity 0–100 (higher hears quieter speech) → noise-gate threshold in dB. 50 → -50 dB. */
export const sensitivityToDb = (sensitivity: number) => -20 - Math.min(100, Math.max(0, sensitivity)) * 0.6

/** Screen share audio is never processed: no browser suppression/echo/gain and no DeepFilterNet (that applies to the mic track only). F11 passes this to LiveKit's screen share audio capture. */
export const SCREEN_AUDIO_CAPTURE = { noiseSuppression: false, echoCancellation: false, autoGainControl: false } as const

/** Screen share presets by quality setting (PLAN §8). Eco (default): 5 fps up to 1440p tuned for sharp text. Smooth: 60 fps up to 1080p. Single layer, never simulcast; VP9 with a VP8 backup. `resolution` is the ceiling (sent as `max` constraints), bitrate is an upper limit. */
export const SCREEN_SHARE_PRESETS = {
  eco: { resolution: { width: 2560, height: 1440, frameRate: 5 }, codec: 'vp9', contentHint: 'detail', degradationPreference: 'maintain-resolution', maxBitrate: 5_000_000 },
  smooth: { resolution: { width: 1920, height: 1080, frameRate: 60 }, codec: 'vp9', contentHint: 'motion', degradationPreference: 'maintain-framerate', maxBitrate: 15_000_000 }
} as const
export type ScreenQuality = keyof typeof SCREEN_SHARE_PRESETS

/** Room-wide publish/capture defaults: one layer per track, 1080p30 camera at 6 Mbps, mic Opus 128 kbps without DTX (no comfort-noise gaps) and with RED. */
export const VOICE_PUBLISH_DEFAULTS = { simulcast: false, videoEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 }, audioPreset: { maxBitrate: 128_000 }, dtx: false, red: true } as const
export const CAMERA_CAPTURE = { resolution: { width: 1920, height: 1080, frameRate: 30 } } as const
/** Screen audio: stereo Opus 256 kbps, DTX off. */
export const SCREEN_AUDIO_PUBLISH = { audioPreset: { maxBitrate: 256_000 }, forceStereo: true, dtx: false } as const

export interface UserVolume { mic: number, screen: number, muted: boolean }
export const userVolume = (all: Record<string, Partial<UserVolume>>, id: string): UserVolume => ({ mic: 1, screen: 1, muted: false, ...all[id] })

/** Playback volume (0–1) of one remote audio track: deafen and "mute for me" silence it, otherwise the per-user slider times the output volume. */
export const effectiveVolume = (deafened: boolean, v: UserVolume, kind: 'mic' | 'screen', output: number) =>
  deafened || v.muted ? 0 : Math.min(1, Math.max(0, v[kind])) * output
