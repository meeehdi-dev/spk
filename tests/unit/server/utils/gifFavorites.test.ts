import { describe, expect, it } from 'vitest'

import { gifFavoriteDto, isGifId } from '~~/server/utils/gifFavorites'
import { gif } from '~~/tests/fixtures/gifs'

describe('GIF favorite validation', () => {
  it('accepts provider IDs and bounded metadata, dropping unknown fields', () => {
    expect(isGifId('ABC_123-slug')).toBe(true)
    expect(gifFavoriteDto(gif.id, { ...gif, userId: 'someone-else', width: 0 })).toEqual({ ...gif, width: 0 })
  })
  it.each([undefined, '', '../admin', 'a/b', 'a'.repeat(129), ['123']])('rejects invalid identifier %j', value => {
    expect(isGifId(value)).toBe(false)
  })
  it.each([
    null,
    {},
    { ...gif, title: 'a'.repeat(501) },
    { ...gif, title: 4 },
    { ...gif, width: -1 },
    { ...gif, width: 0.5 },
    { ...gif, width: '3' },
    { ...gif, height: 10001 },
    { ...gif, height: Infinity },
  ])('rejects invalid metadata %j', value => {
    expect(gifFavoriteDto(gif.id, value)).toBeNull()
  })
  it.each([
    'http://example.com/a.gif',
    'javascript:alert(1)',
    'data:image/gif;base64,abc',
    'https://user:pass@example.com/a.gif',
    'https://example.com:123/a.gif',
    'https://localhost/a.gif',
    'https://host.local/a.gif',
    'https://host.localhost/a.gif',
    'https://127.0.0.1/a.gif',
    'https://10.0.0.1/a.gif',
    'https://[::1]/a.gif',
    'https://127.1/a.gif',
    'https://host.local./a.gif',
    'https://example.com/with space.gif',
    `https://example.com/${'a'.repeat(4096)}`,
  ])('rejects unsafe URL %s in either URL field', url => {
    expect(gifFavoriteDto(gif.id, { ...gif, url })).toBeNull()
    expect(gifFavoriteDto(gif.id, { ...gif, preview: url })).toBeNull()
  })
})
