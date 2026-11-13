import { describe, expect, it } from 'vitest'

import { parseHtml } from '~~/server/utils/previews'

describe('parseHtml', () => {
  it('reads Open Graph data and makes the image absolute', async () => {
    const p = await parseHtml(
      '<head><meta property="og:title" content="Hi"><meta property="og:description" content="D"><meta property="og:site_name" content="S"><meta property="og:image" content="/i.png"></head>',
      'https://x.example/a/b',
    )
    expect(p).toEqual({ title: 'Hi', description: 'D', siteName: 'S', image: 'https://x.example/i.png' })
  })
})
