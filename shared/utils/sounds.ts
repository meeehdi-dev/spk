/** Soundboard rules and the WAV encoder, shared by the server (presign limits) and the browser (cropping). */
export const MAX_SOUND_MS = 10_000
export const MAX_SOUND_BYTES = 1.5 * 1024 * 1024
export const MAX_SOUND_SOURCE_BYTES = 20 * 1024 * 1024
export const SOUND_COOLDOWN_MS = 3_000
export const SOUND_RATE = 48_000
export const SOUND_MIME = 'audio/wav'

/** The part of a decoded file between `startS` and `endS` (at most 10 s), channels averaged to mono. */
export function cropMono(channels: Float32Array[], sampleRate: number, startS: number, endS: number): Float32Array {
  const from = Math.max(0, Math.floor(startS * sampleRate))
  const to = Math.min(channels[0]?.length ?? 0, from + Math.floor(Math.min(endS - startS, MAX_SOUND_MS / 1000) * sampleRate))
  const out = new Float32Array(Math.max(0, to - from))
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += ch[from + i]! / channels.length
  return out
}

/** 16-bit PCM mono WAV (44-byte header + samples). */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // mono, byte rate
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true) // block align, bits
  text(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * (s < 0 ? 0x8000 : 0x7fff)), true))
  return new Uint8Array(buf)
}
