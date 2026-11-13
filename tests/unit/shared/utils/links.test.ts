import { describe, expect, it } from 'vitest'

import { composeBody, extractUrls, isImageUrl, previewUrls } from '#shared/utils/links'

describe('previewUrls', () => {
  it('selects normalized, distinct preview links after excluding images and internal links', () => {
    const body = [
      'https://static.example/a.gif',
      'http://localhost:3000/c/abc/m/def',
      '<https://skip.example/>',
      'https://a.example https://a.example/',
      'https://b.example https://c.example https://d.example',
    ].join(' ')
    expect(previewUrls(body, 'http://localhost:3000')).toEqual(['https://a.example/', 'https://b.example/', 'https://c.example/'])
  })
})

describe('extractUrls', () => {
  it('distinct http(s) links; skips <url>, code, spoilers and internal links', () => {
    const body = [
      'see https://a.example/x?y=1, and (https://b.example/p_(q)). also https://a.example/x?y=1',
      '<https://skip.example/> `https://code.example` ||https://spoiler.example||',
      '```\nhttps://fence.example\n```',
      'http://localhost:3000/c/abc/m/def',
      'ftp://nope.example',
      '**https://bold.example**',
    ].join('\n')
    expect(extractUrls(body, 'http://localhost:3000')).toEqual(['https://a.example/x?y=1', 'https://b.example/p_(q)', 'https://bold.example/'])
  })
})

describe('composeBody', () => {
  it('text, gif, or both (gif on its own line after the text)', () => {
    expect(composeBody(' hi ')).toBe('hi')
    expect(composeBody('', 'https://x/a.gif')).toBe('https://x/a.gif')
    expect(composeBody('hi', 'https://x/a.gif')).toBe('hi\nhttps://x/a.gif')
  })
})

describe('isImageUrl', () => {
  it('https + image extension on any host', () => {
    for (const ext of ['gif', 'png', 'jpg', 'jpeg', 'webp', 'GIF', 'JpG']) expect(isImageUrl(`https://example.com/a/b.${ext}`)).toBe(true)
    expect(isImageUrl('https://static.klipy.com/ii/abc/def/x.gif')).toBe(true)
    expect(isImageUrl('https://media.tenor.com/x/y.gif?w=1')).toBe(true)
    expect(isImageUrl('http://example.com/a.gif')).toBe(false)
    expect(isImageUrl('https://example.com/a.svg')).toBe(false)
    expect(isImageUrl('https://example.com/page')).toBe(false)
    expect(isImageUrl('https://example.com/page?f=a.gif')).toBe(false)
    expect(isImageUrl('https://example.com/a.gif#x.png')).toBe(true)
    expect(isImageUrl('https://example.com/a b.gif')).toBe(false)
    expect(isImageUrl(' https://example.com/a.gif')).toBe(false)
    expect(isImageUrl('<https://example.com/a.gif>')).toBe(false)
  })
})
