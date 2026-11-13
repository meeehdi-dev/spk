import { describe, expect, it } from 'vitest'

import { MAX_SOUND_BYTES } from '#shared/utils/sounds'
import { checkSoundSize, createSound, deleteSound, listSounds, updateSound } from '~~/server/db/sounds'
import { addUser, test } from '~~/tests/fixtures/db'

const id = '11111111-1111-4111-8111-111111111111'

describe('checkSoundSize', () => {
  it('presign accepts only small files', () => {
    expect(checkSoundSize(1000)).toBe(1000)
    expect(() => checkSoundSize(MAX_SOUND_BYTES + 1)).toThrow('1.5 MB')
    expect(() => checkSoundSize(10)).toThrow()
    expect(() => checkSoundSize('9')).toThrow()
  })
})

describe('sounds', () => {
  test.beforeEach(({ db }) => addUser(db, 'a', { role: 'admin' }))

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
