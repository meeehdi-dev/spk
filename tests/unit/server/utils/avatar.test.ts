import { describe, expect, it } from 'vitest'

import { isAvatarRawKey } from '~~/server/utils/avatar'

const id = '0f1e2d3c-aaaa-bbbb-cccc-1234567890ab'

describe('isAvatarRawKey', () => {
  it('accepts the key the upload route generates', () => {
    expect(isAvatarRawKey('u1', `avatars/raw/u1/${id}`)).toBe(true)
  })
  it('rejects traversal, other users and other shapes', () => {
    for (const k of [
      `avatars/raw/u1/../../attachments/x/y`,
      `avatars/raw/u1/${id}/../../x`,
      `avatars/raw/u2/${id}`,
      `avatars/raw/u1/abc`,
      `avatars/raw/u1/${id}/x`,
      undefined,
      5,
    ]) {
      expect(isAvatarRawKey('u1', k)).toBe(false)
    }
  })
})
