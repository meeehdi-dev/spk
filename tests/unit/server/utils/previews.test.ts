import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchMetadata, parseHtml } from '~~/server/utils/previews'
import { safeFetch } from '~~/server/utils/ssrf'

vi.mock('~~/server/utils/ssrf', () => ({ safeFetch: vi.fn() }))

beforeEach(() => vi.resetAllMocks())

describe('fetchMetadata', () => {
  it.each([
    'https://www.youtube.com/watch?v=Rvllqomd3E8&t=12',
    'https://youtu.be/Rvllqomd3E8?si=shared',
    'https://m.youtube.com/watch?v=Rvllqomd3E8',
    'https://youtube.com/shorts/Rvllqomd3E8',
    'https://www.youtube.com/live/Rvllqomd3E8',
    'https://www.youtube.com/embed/Rvllqomd3E8',
  ])('uses bounded, SSRF-guarded oEmbed for %s', async url => {
    vi.mocked(safeFetch).mockResolvedValue({
      url: 'https://www.youtube.com/oembed',
      contentType: 'application/json',
      truncated: false,
      body: Buffer.from(
        JSON.stringify({ title: 'Walid ouvre la porte', author_name: 'Video author', thumbnail_url: 'https://i.ytimg.com/vi/Rvllqomd3E8/hqdefault.jpg' }),
      ),
    })
    expect(await fetchMetadata(url)).toEqual({
      title: 'Walid ouvre la porte',
      description: 'Video author',
      siteName: 'YouTube',
      image: 'https://i.ytimg.com/vi/Rvllqomd3E8/hqdefault.jpg',
    })
    const endpoint = new URL(vi.mocked(safeFetch).mock.calls[0]![0])
    expect(endpoint.origin + endpoint.pathname).toBe('https://www.youtube.com/oembed')
    expect(endpoint.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=Rvllqomd3E8')
    expect(endpoint.searchParams.get('format')).toBe('json')
    expect(safeFetch).toHaveBeenCalledExactlyOnceWith(endpoint.href, { accept: 'json', maxBytes: 64 * 1024 })
  })

  it.each([
    'https://example.com/watch?v=Rvllqomd3E8',
    'https://youtube.com.evil.example/watch?v=Rvllqomd3E8',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/watch?v=invalid',
    'https://user:secret@www.youtube.com/watch?v=Rvllqomd3E8',
    'https://www.youtube.com:8080/watch?v=Rvllqomd3E8',
    'ftp://www.youtube.com/watch?v=Rvllqomd3E8',
  ])('keeps other URLs on the original guarded HTML path: %s', async url => {
    vi.mocked(safeFetch).mockResolvedValue({ url, contentType: 'text/html', truncated: false, body: Buffer.from('<title>Page</title>') })
    expect(await fetchMetadata(url)).toMatchObject({ title: 'Page' })
    expect(safeFetch).toHaveBeenCalledExactlyOnceWith(url, { accept: 'html' })
  })

  it('rejects unusable oEmbed responses rather than caching a generic card', async () => {
    vi.mocked(safeFetch).mockResolvedValue({ url: '', contentType: 'application/json', truncated: false, body: Buffer.from('{"title":42}') })
    await expect(fetchMetadata('https://youtu.be/Rvllqomd3E8')).rejects.toThrow('Missing YouTube video title')
    vi.mocked(safeFetch).mockRejectedValue(new Error('HTTP 404'))
    await expect(fetchMetadata('https://youtu.be/Rvllqomd3E8')).rejects.toThrow('HTTP 404')
  })
})

describe('parseHtml', () => {
  it('reads Open Graph data and makes the image absolute', async () => {
    const p = await parseHtml(
      '<head><meta property="og:title" content="Hi"><meta property="og:description" content="D"><meta property="og:site_name" content="S"><meta property="og:image" content="/i.png"></head>',
      'https://x.example/a/b',
    )
    expect(p).toEqual({ title: 'Hi', description: 'D', siteName: 'S', image: 'https://x.example/i.png' })
  })
})
