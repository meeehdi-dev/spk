import { describe, expect, it } from 'vitest'

import { mapGifs } from '~~/server/utils/klipy'

describe('mapGifs', () => {
  it('keeps order and skips entries without formats', () => {
    const r = mapGifs({
      data: {
        has_next: true,
        data: [
          {
            id: 1,
            title: 'a',
            file: { md: { gif: { url: 'https://static.klipy.com/a.gif', width: 2, height: 3 } }, sm: { webp: { url: 'https://static.klipy.com/a.webp' } } },
          },
          { type: 'ad', content: '<script>' },
          { id: 2, title: 'b', file: { md: { gif: { url: 'https://static.klipy.com/b.gif' } } } },
        ],
      },
    })
    expect(r.hasNext).toBe(true)
    expect(r.items.map(i => [i.id, i.url, i.preview])).toEqual([
      ['1', 'https://static.klipy.com/a.gif', 'https://static.klipy.com/a.webp'],
      ['2', 'https://static.klipy.com/b.gif', 'https://static.klipy.com/b.gif'],
    ])
  })
})
