import { beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../server/db/client'
import { user } from '../server/db/schema'
import { checkSoundSize, createSound, deleteSound, listSounds, updateSound } from '../server/db/sounds'
import { createLimiter } from '../server/utils/limiter'
import { joinVoice, leaveVoice, soundAudience } from '../server/utils/voicePresence'
import { cropMono, encodeWav, MAX_SOUND_BYTES, SOUND_COOLDOWN_MS } from '../shared/utils/sounds'

describe('WAV encoder', () => {
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

describe('crop', () => {
  it('cuts the selection, mixes to mono and caps at 10 s', () => {
    const l = new Float32Array([1, 1, 1, 1]),
      r = new Float32Array([0, 0, 0, 0])
    expect(Array.from(cropMono([l, r], 4, 0.25, 0.75))).toEqual([0.5, 0.5])
    expect(cropMono([new Float32Array(100)], 4, 0, 100).length).toBe(40)
  })
})

describe('cooldown', () => {
  it('allows one sound per 3 s per user', () => {
    const allow = createLimiter(1, SOUND_COOLDOWN_MS)
    expect(allow('a', 0)).toBe(true)
    expect(allow('a', 2_999)).toBe(false)
    expect(allow('b', 1_000)).toBe(true)
    expect(allow('a', 3_000)).toBe(true)
  })
})

describe('sounds', () => {
  let db: Db
  const id = '11111111-1111-4111-8111-111111111111'
  beforeEach(() => {
    db = createDb(':memory:')
    db.insert(user).values({ id: 'a', name: 'a', email: 'a@x.dev', role: 'admin' }).run()
  })

  it('presign accepts only small files', () => {
    expect(checkSoundSize(1000)).toBe(1000)
    expect(() => checkSoundSize(MAX_SOUND_BYTES + 1)).toThrow('1.5 MB')
    expect(() => checkSoundSize(10)).toThrow()
    expect(() => checkSoundSize('9')).toThrow()
  })
  it('saves only an uploaded object of the announced size, then edits name and icon and deletes', () => {
    const body = { id, name: ' Airhorn ', icon: 'siren', durationMs: 2000, size: 5000 }
    expect(() => createSound(db, 'a', body, null)).toThrow('not uploaded')
    expect(() => createSound(db, 'a', body, 4999)).toThrow('not uploaded')
    expect(() => createSound(db, 'a', { ...body, durationMs: 20_000 }, 5000)).toThrow('10 s')
    expect(() => createSound(db, 'a', { ...body, id: '../x' }, 5000)).toThrow('Bad sound id')
    expect(createSound(db, 'a', body, 5000)).toMatchObject({ name: 'Airhorn', r2Key: `sounds/${id}` })
    expect(() => createSound(db, 'a', body, 5000)).toThrow('Already saved')
    expect(updateSound(db, id, { name: 'Horn', icon: 'bell' })).toMatchObject({ name: 'Horn', icon: 'bell' })
    expect(listSounds(db)).toHaveLength(1)
    expect(deleteSound(db, id)).toBe(`sounds/${id}`)
    expect(deleteSound(db, id)).toBeNull()
  })
})

describe('sound relay audience', () => {
  it('is the channel of the current session only', () => {
    joinVoice('s1', 'ch', 'x', {})
    joinVoice('s2', 'ch', 'y', {})
    joinVoice('s3', 'other', 'z', {})
    expect(soundAudience('s1', 'x')?.sort()).toEqual(['s1', 's2'])
    expect(soundAudience('s1', 'stale')).toBeNull()
    expect(soundAudience('nobody', 'x')).toBeNull()
    for (const [u, s] of [
      ['s1', 'x'],
      ['s2', 'y'],
      ['s3', 'z'],
    ] as const)
      leaveVoice(u, s)
    expect(soundAudience('s1', 'x')).toBeNull()
  })
})
