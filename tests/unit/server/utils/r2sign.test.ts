import { describe, expect, it } from 'vitest'

import { r2Url } from '~~/server/utils/r2sign'

const cfg = { accountId: 'acct', accessKeyId: 'k', secretAccessKey: 's', bucket: 'spk' }

describe('r2Url', () => {
  it('rejects dot segments', () => {
    expect(() => r2Url(cfg, 'avatars/raw/u1/../../sounds/a')).toThrow(/Invalid R2 key/)
    expect(() => r2Url(cfg, 'a/./b')).toThrow()
  })
  it('builds normal keys', () => {
    expect(r2Url(cfg, 'a/b c')).toBe('https://acct.r2.cloudflarestorage.com/spk/a/b%20c')
  })
})
