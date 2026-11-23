/** Soundboard rules and the WAV encoder, shared by the server (presign limits) and the browser (cropping). */
export const MAX_SOUND_MS = 10_000
export const MAX_SOUND_BYTES = 3 * 1024 * 1024
export const MAX_SOUND_SOURCE_BYTES = 20 * 1024 * 1024
/** After their sound ends, its player waits this long so others get the next turn. */
export const SOUND_REST_MS = 1_000
export const SOUND_RATE = 48_000
export const SOUND_MIME = 'audio/wav'

function channelLength(channels: Float32Array[]): number {
  if (channels.length < 1 || channels.length > 2) throw new Error('Only mono or stereo sounds are supported')
  if (channels.some(channel => !(channel instanceof Float32Array))) throw new Error('Channels must be Float32Array samples')
  const length = channels[0]!.length
  if (channels.some(channel => channel.length !== length)) throw new Error('Channels must have equal lengths')
  return length
}

/** The part of a decoded mono/stereo file between `startS` and `endS` (at most 10 s), preserving channels. */
export function cropChannels(channels: Float32Array[], sampleRate: number, startS: number, endS: number): Float32Array[] {
  const length = channelLength(channels)
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('Bad sample rate')
  if (!Number.isFinite(startS) || !Number.isFinite(endS)) throw new Error('Bad crop boundaries')
  const from = Math.min(length, Math.max(0, Math.floor(startS * sampleRate)))
  const to = Math.max(from, Math.min(length, Math.floor(endS * sampleRate), from + Math.floor((MAX_SOUND_MS / 1000) * sampleRate)))
  return channels.map(channel => channel.slice(from, to))
}

/** Whether baking in gain would produce invalid samples or peaks outside the PCM range. */
export function hasSoundClipping(channels: Float32Array[], gain = 1): boolean {
  return !Number.isFinite(gain) || gain < 0 || channels.some(channel => channel.some(sample => !Number.isFinite(sample * gain) || Math.abs(sample * gain) > 1))
}

/** Interleaved 24-bit PCM mono/stereo WAV, with gain baked in; invalid or clipping samples are rejected. */
export function encodeWav(channels: Float32Array[], sampleRate: number, gain = 1): Uint8Array {
  const length = channelLength(channels)
  if (!length) throw new Error('Sound must contain samples')
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('Bad sample rate')
  if (!Number.isFinite(gain) || gain < 0) throw new Error('Gain must be finite and nonnegative')
  if (hasSoundClipping(channels, gain)) throw new Error('Sound clips or contains nonfinite samples')
  const blockAlign = channels.length * 3
  const dataBytes = length * blockAlign
  const buf = new ArrayBuffer(44 + dataBytes + (dataBytes % 2))
  const v = new DataView(buf)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, buf.byteLength - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, channels.length, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * blockAlign, true)
  v.setUint16(32, blockAlign, true)
  v.setUint16(34, 24, true)
  text(36, 'data')
  v.setUint32(40, dataBytes, true)
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels.length; ch++) {
      const sample = channels[ch]![i]! * gain
      const pcm = Math.round(sample * (sample < 0 ? 0x800000 : 0x7fffff))
      const at = 44 + i * blockAlign + ch * 3
      v.setUint8(at, pcm & 0xff)
      v.setUint8(at + 1, (pcm >> 8) & 0xff)
      v.setUint8(at + 2, (pcm >> 16) & 0xff)
    }
  }
  return new Uint8Array(buf)
}
