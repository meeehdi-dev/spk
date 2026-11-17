import { describe, expect, it } from 'vitest'

import { cropChannels, encodeWav, hasSoundClipping, MAX_SOUND_BYTES, SOUND_RATE } from '#shared/utils/sounds'

function readPcm(wav: Uint8Array): number[] {
  const view = new DataView(wav.buffer)
  return Array.from({ length: view.getUint32(40, true) / 3 }, (_, i) => {
    const at = 44 + i * 3
    const value = wav[at]! | (wav[at + 1]! << 8) | (wav[at + 2]! << 16)
    return (value << 8) >> 8
  })
}

describe('encodeWav', () => {
  it.each([1, 2])('writes a %i-channel 24-bit PCM header with interleaved channel order', count => {
    const channels = [new Float32Array([0, 1, -1, 0.5]), new Float32Array([-0.5, -1, 1, 0])].slice(0, count)
    const wav = encodeWav(channels, SOUND_RATE)
    const v = new DataView(wav.buffer)
    const tag = (at: number) => String.fromCharCode(...wav.slice(at, at + 4))
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(wav.length).toBe(44 + 4 * count * 3)
    expect(v.getUint32(4, true)).toBe(wav.length - 8)
    expect(v.getUint32(16, true)).toBe(16)
    expect([
      v.getUint16(20, true),
      v.getUint16(22, true),
      v.getUint32(24, true),
      v.getUint32(28, true),
      v.getUint16(32, true),
      v.getUint16(34, true),
      v.getUint32(40, true),
    ]).toEqual([1, count, 48_000, 48_000 * count * 3, count * 3, 24, 4 * count * 3])
    expect(readPcm(wav)).toEqual(count === 1 ? [0, 8388607, -8388608, 4194304] : [0, -4194304, 8388607, -8388608, -8388608, 8388607, 4194304, 0])
  })

  it('pads odd data bytes without counting the pad in the data chunk', () => {
    const wav = encodeWav([new Float32Array([1])], SOUND_RATE)
    const view = new DataView(wav.buffer)
    expect(wav.length).toBe(48)
    expect(view.getUint32(4, true)).toBe(40)
    expect(view.getUint32(40, true)).toBe(3)
    expect(Array.from(wav.slice(44))).toEqual([0xff, 0xff, 0x7f, 0])
  })

  it('retains quiet detail below 16-bit precision', () => {
    const wav = encodeWav([new Float32Array([1 / 0x800000, -1 / 0x800000])], SOUND_RATE)
    expect(readPcm(wav)).toEqual([1, -1])
  })

  it('bakes attenuation, safe amplification and mute into samples without mutating the source', () => {
    const samples = new Float32Array([0.25, -0.25, 0.5, -0.5])
    const pcm = (gain: number) => readPcm(encodeWav([samples], SOUND_RATE, gain))
    expect(pcm(0.5)).toEqual([1048576, -1048576, 2097152, -2097152])
    expect(pcm(2)).toEqual([4194304, -4194304, 8388607, -8388608])
    expect(pcm(0)).toEqual([0, 0, 0, 0])
    expect(Array.from(samples)).toEqual([0.25, -0.25, 0.5, -0.5])
    expect(readPcm(encodeWav([new Float32Array([2, -2])], SOUND_RATE, 0.5))).toEqual([8388607, -8388608])
  })

  it.each([NaN, Infinity, -Infinity, 1.01, -1.01])('rejects invalid gained sample %s, including in the right channel', sample => {
    expect(() => encodeWav([new Float32Array([0]), new Float32Array([sample])], SOUND_RATE)).toThrow('clips or contains nonfinite')
  })

  it('rejects amplification that clips rather than clamping peaks', () => {
    expect(() => encodeWav([new Float32Array([0.75])], SOUND_RATE, 2)).toThrow('clips')
    expect(() => encodeWav([new Float32Array([Infinity])], SOUND_RATE, 0)).toThrow('nonfinite')
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid gain %s', gain => {
    expect(() => encodeWav([new Float32Array([0])], SOUND_RATE, gain)).toThrow('Gain')
  })

  it('rejects unsupported channels, unequal or empty lengths, and invalid sample rates', () => {
    expect(() => encodeWav([], SOUND_RATE)).toThrow('mono or stereo')
    expect(() =>
      encodeWav(
        Array.from({ length: 3 }, () => new Float32Array(1)),
        SOUND_RATE,
      ),
    ).toThrow('mono or stereo')
    expect(() => encodeWav([new Float32Array(1), new Float32Array(2)], SOUND_RATE)).toThrow('equal lengths')
    expect(() => encodeWav([new Float32Array()], SOUND_RATE)).toThrow('contain samples')
    for (const rate of [0, -1, NaN, Infinity, 0.5]) expect(() => encodeWav([new Float32Array(1)], rate)).toThrow('sample rate')
  })

  it('10 s of stereo 48 kHz 24-bit PCM fits the 3 MB upload limit', () => {
    expect(SOUND_RATE).toBe(48_000)
    const wav = encodeWav([new Float32Array(480_000), new Float32Array(480_000)], SOUND_RATE)
    expect(wav.length).toBe(2_880_044)
    expect(wav.length).toBeLessThan(MAX_SOUND_BYTES)
  })
})

describe('hasSoundClipping', () => {
  it('checks all channels after gain, accepting exact full scale and safe attenuation', () => {
    expect(hasSoundClipping([new Float32Array([-1, 0, 1])])).toBe(false)
    expect(hasSoundClipping([new Float32Array([0.5]), new Float32Array([-0.75])], 2)).toBe(true)
    expect(hasSoundClipping([new Float32Array([2, -2])], 0.5)).toBe(false)
    expect(hasSoundClipping([new Float32Array([2, -2])], 0)).toBe(false)
  })

  it.each([NaN, Infinity, -Infinity])('flags nonfinite sample %s even when muted', sample => {
    expect(hasSoundClipping([new Float32Array([sample])])).toBe(true)
    expect(hasSoundClipping([new Float32Array([sample])], 0)).toBe(true)
  })

  it.each([-1, NaN, Infinity])('flags invalid gain %s', gain => {
    expect(hasSoundClipping([new Float32Array([0])], gain)).toBe(true)
  })
})

describe('cropChannels', () => {
  it.each([1, 2])('cuts a %i-channel selection without mixing or modifying input', count => {
    const channels = [new Float32Array([1, 0.5, -0.5, -1]), new Float32Array([0, -0.25, 0.25, 1])].slice(0, count)
    const cropped = cropChannels(channels, 4, 0.25, 0.75)
    expect(cropped.map(channel => Array.from(channel))).toEqual(
      [
        [0.5, -0.5],
        [-0.25, 0.25],
      ].slice(0, count),
    )
    cropped[0]![0] = 0
    expect(channels[0]![1]).toBe(0.5)
  })

  it('caps every channel at 10 s', () => {
    expect(cropChannels([new Float32Array(100), new Float32Array(100)], 4, 1, 100).map(channel => channel.length)).toEqual([40, 40])
  })

  it('clamps to source boundaries, floors frame positions and returns empty selections', () => {
    const channels = [new Float32Array([0, 1, 2, 3])]
    expect(Array.from(cropChannels(channels, 4, -1, 0.5)[0]!)).toEqual([0, 1])
    expect(Array.from(cropChannels(channels, 4, 0.49, 2)[0]!)).toEqual([1, 2, 3])
    for (const [start, end] of [
      [2, 3],
      [0.5, 0.5],
      [0.75, 0.25],
      [-2, -1],
    ]) {
      expect(cropChannels(channels, 4, start!, end!)[0]).toHaveLength(0)
    }
  })

  it('rejects unsupported or mismatched channels and invalid crop parameters', () => {
    expect(() => cropChannels([], 4, 0, 1)).toThrow('mono or stereo')
    expect(() =>
      cropChannels(
        Array.from({ length: 3 }, () => new Float32Array(4)),
        4,
        0,
        1,
      ),
    ).toThrow('mono or stereo')
    expect(() => cropChannels([new Float32Array(4), new Float32Array(2)], 4, 0, 1)).toThrow('equal lengths')
    expect(() => cropChannels([new Float32Array(4)], 0, 0, 1)).toThrow('sample rate')
    expect(() => cropChannels([new Float32Array(4)], 4, NaN, 1)).toThrow('boundaries')
    expect(() => cropChannels([new Float32Array(4)], 4, 0, Infinity)).toThrow('boundaries')
  })
})
