import { describe, expect, it } from 'vitest'

import { isAvatarRawKey } from '../server/utils/avatar'
import { r2Url } from '../server/utils/r2sign'

const id = '0f1e2d3c-aaaa-bbbb-cccc-1234567890ab'
const cfg = { accountId: 'acct', accessKeyId: 'k', secretAccessKey: 's', bucket: 'spk' }

describe('avatar raw key', () => {
  it('accepts the key the upload route generates', () => {
    expect(isAvatarRawKey('u1', `avatars/raw/u1/${id}`)).toBe(true)
  })
  it('rejects traversal, other users and other shapes', () => {
    for (const k of [`avatars/raw/u1/../../attachments/x/y`, `avatars/raw/u1/${id}/../../x`, `avatars/raw/u2/${id}`, `avatars/raw/u1/abc`, `avatars/raw/u1/${id}/x`, undefined, 5]) {
      expect(isAvatarRawKey('u1', k)).toBe(false)
    }
  })
})

describe('r2Url', () => {
  it('rejects dot segments', () => {
    expect(() => r2Url(cfg, 'avatars/raw/u1/../../sounds/a')).toThrow(/Invalid R2 key/)
    expect(() => r2Url(cfg, 'a/./b')).toThrow()
  })
  it('builds normal keys', () => {
    expect(r2Url(cfg, 'a/b c')).toBe('https://acct.r2.cloudflarestorage.com/spk/a/b%20c')
  })
})
