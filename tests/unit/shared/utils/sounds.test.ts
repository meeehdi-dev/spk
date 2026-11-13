import { describe, expect, it } from 'vitest'

import { cropMono, encodeWav, MAX_SOUND_BYTES } from '#shared/utils/sounds'

describe('encodeWav', () => {
  it('writes a mono 16-bit PCM header and the right length', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 48_000)
    const v = new DataView(wav.buffer)
    const tag = (at: number) => String.fromCharCode(...wav.slice(at, at + 4))
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(wav.length).toBe(44 + 8)
    expect(v.getUint32(4, true)).toBe(wav.length - 8)
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint32(28, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([
      1, 1, 48_000, 96_000, 16, 8,
    ])
    expect([v.getInt16(46, true), v.getInt16(48, true)]).toEqual([32767, -32768])
  })
  it('10 s of mono 48 kHz fits the upload limit', () => {
    expect(encodeWav(new Float32Array(480_000), 48_000).length).toBeLessThan(MAX_SOUND_BYTES)
  })
})

describe('cropMono', () => {
  it('cuts the selection, mixes to mono and caps at 10 s', () => {
    const l = new Float32Array([1, 1, 1, 1]),
      r = new Float32Array([0, 0, 0, 0])
    expect(Array.from(cropMono([l, r], 4, 0.25, 0.75))).toEqual([0.5, 0.5])
    expect(cropMono([new Float32Array(100)], 4, 0, 100).length).toBe(40)
  })
})
