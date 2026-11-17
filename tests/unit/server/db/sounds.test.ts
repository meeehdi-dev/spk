import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { MAX_SOUND_BYTES } from '#shared/utils/sounds'
import { checkSoundSize, createSound, deleteSound, listSounds, updateSound } from '~~/server/db/sounds'
import { addUser, test } from '~~/tests/fixtures/db'

const id = '11111111-1111-4111-8111-111111111111'

describe('checkSoundSize', () => {
  it('presign accepts only small files', () => {
    expect(checkSoundSize(1000)).toBe(1000)
    expect(MAX_SOUND_BYTES).toBe(3 * 1024 * 1024)
    expect(checkSoundSize(MAX_SOUND_BYTES)).toBe(MAX_SOUND_BYTES)
    expect(checkSoundSize(44 + 480_000 * 2 * 3)).toBe(2_880_044)
    expect(() => checkSoundSize(MAX_SOUND_BYTES + 1)).toThrow('3 MB')
    expect(() => checkSoundSize(10)).toThrow()
    expect(() => checkSoundSize('9')).toThrow()
    for (const size of [44, 0, -1, 100.5, NaN, Infinity]) expect(() => checkSoundSize(size)).toThrow('Bad file size')
  })
})

describe('sounds', () => {
  test.beforeEach(({ db }) => addUser(db, 'a', { role: 'admin' }))

  test('lists sounds alphabetically regardless of case without changing their names', ({ db }) => {
    for (const name of ['zebra', 'Banana', 'apple', 'Apricot']) {
      createSound(db, 'a', { id: randomUUID(), name, icon: 'bell', durationMs: 1000, size: 5000 }, 5000)
    }

    expect(listSounds(db).map(sound => sound.name)).toEqual(['apple', 'Apricot', 'Banana', 'zebra'])
  })

  test('saves only an uploaded object of the announced size, then edits name and icon and deletes', ({ db }) => {
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
