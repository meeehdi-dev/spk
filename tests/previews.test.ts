import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../server/db/client'
import { createMessage, deleteMessage, editMessage, listMessages } from '../server/db/messages'
import { attachPreviews, cachedPreview, previewImageKey, removePreview, savePreview } from '../server/db/previews'
import { channelMembers, channels, user } from '../server/db/schema'
import { isBlockedIp, safeFetch, SsrfError } from '../server/utils/ssrf'
import { mapGifs } from '../server/utils/klipy'
import { parseHtml } from '../server/utils/previews'
import { composeBody, extractUrls, isImageUrl } from '../shared/utils/links'

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', 'ff02::1', 'not-an-ip'
  ])('blocks %s', ip => expect(isBlockedIp(ip)).toBe(true))
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', ip => expect(isBlockedIp(ip)).toBe(false))
})

describe('safeFetch', () => {
  let server: http.Server
  let port: number
  const hits: string[] = []
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(`${req.headers.host}${req.url}`)
      const url = req.url!
      if (url === '/page') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<title>x</title>') }
      else if (url === '/big') { res.setHeader('content-type', 'text/html'); res.end('a'.repeat(5000)) }
      else if (url === '/json') { res.setHeader('content-type', 'application/json'); res.end('{}') }
      else if (url === '/img') { res.setHeader('content-type', 'image/png'); res.end(Buffer.alloc(5000)) }
      else if (url === '/loop') { res.statusCode = 302; res.setHeader('location', '/loop'); res.end() }
      else if (url === '/to-private') { res.statusCode = 302; res.setHeader('location', 'http://internal.test/secret'); res.end() }
      else if (url === '/slow') { res.setHeader('content-type', 'text/html'); res.write('<title>'); /* never ends */ }
      else if (url === '/redir') { res.statusCode = 301; res.setHeader('location', '/page'); res.end() }
      else { res.statusCode = 404; res.end() }
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => { server.closeAllConnections(); server.close() })
  beforeEach(() => { hits.length = 0 })

  // The test server is on loopback, so the real IP rule is swapped for "only 127.0.0.1" and the port rule for its port.
  const local = { allowIp: (ip: string) => ip === '127.0.0.1', allowPort: (p: number) => p === port }
  const pub = { resolve: async () => ['93.184.216.34'] }

  it('rejects non-http schemes, bad ports, credentials and private/loopback literals (defaults)', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://x/', 'javascript:alert(1)', 'http://example.com:8080/', 'https://example.com:22/',
      'http://user:pw@example.com/', 'http://127.0.0.1/', 'http://127.0.0.1:80/', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/',
      'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0/', 'http://2130706433/', 'http://0x7f.1/']) {
      await expect(safeFetch(u, { accept: 'html', ...pub }), u).rejects.toBeInstanceOf(SsrfError)
    }
    expect(hits).toEqual([])
  })

  it('rejects a name when any of its addresses is private, without connecting', async () => {
    await expect(safeFetch('http://rebind.test/', { accept: 'html', resolve: async () => ['93.184.216.34', '10.0.0.1'] })).rejects.toThrow(/Address not allowed/)
    await expect(safeFetch('http://localhost/', { accept: 'html', resolve: async () => ['::1'] })).rejects.toThrow(/Address not allowed/)
    await expect(safeFetch('http://nothing.test/', { accept: 'html', resolve: async () => [] })).rejects.toThrow(/did not resolve/)
  })

  it('connects to the checked IP, whatever the name resolves to later (pinning)', async () => {
    let lookups = 0
    // The name resolves once, to the loopback test server. A second lookup would "rebind" it to a blocked IP.
    const resolve = async () => (++lookups === 1 ? ['127.0.0.1'] : ['10.0.0.1'])
    const r = await safeFetch(`http://pinned.test:${port}/page`, { accept: 'html', resolve, ...local })
    expect(r.body.toString()).toBe('<title>x</title>')
    expect(lookups).toBe(1)
    expect(hits).toEqual([`pinned.test:${port}/page`]) // connected by IP, Host header is the name
  })

  it('checks the address again after every redirect', async () => {
    const resolve = async (h: string) => (h === 'internal.test' ? ['10.0.0.1'] : ['127.0.0.1'])
    await expect(safeFetch(`http://pub.test:${port}/to-private`, { accept: 'html', resolve, ...local, allowPort: () => true })).rejects.toThrow(/Address not allowed/)
    expect(hits).toEqual([`pub.test:${port}/to-private`])
    const ok = await safeFetch(`http://pub.test:${port}/redir`, { accept: 'html', resolve, ...local })
    expect(ok.url).toBe(`http://pub.test:${port}/page`)
  })

  it('stops after too many redirects', async () => {
    await expect(safeFetch(`http://pub.test:${port}/loop`, { accept: 'html', resolve: async () => ['127.0.0.1'], ...local })).rejects.toThrow(/Too many redirects/)
    expect(hits.length).toBe(4) // the first request + 3 redirects
  })

  it('enforces content type and size', async () => {
    const o = { resolve: async () => ['127.0.0.1'], ...local }
    await expect(safeFetch(`http://a.test:${port}/json`, { accept: 'html', ...o })).rejects.toThrow(/Content type/)
    await expect(safeFetch(`http://a.test:${port}/img`, { accept: 'html', ...o })).rejects.toThrow(/Content type/)
    await expect(safeFetch(`http://a.test:${port}/page`, { accept: 'image', ...o })).rejects.toThrow(/Content type/)
    await expect(safeFetch(`http://a.test:${port}/img`, { accept: 'image', maxBytes: 1000, ...o })).rejects.toThrow(/size limit/)
    expect((await safeFetch(`http://a.test:${port}/img`, { accept: 'image', ...o })).body.length).toBe(5000)
    const cut = await safeFetch(`http://a.test:${port}/big`, { accept: 'html', maxBytes: 1000, ...o })
    expect(cut.truncated).toBe(true)
    expect(cut.body.length).toBeLessThanOrEqual(1000 + 65536) // whole chunks only
    await expect(safeFetch(`http://a.test:${port}/missing`, { accept: 'html', ...o })).rejects.toThrow(/HTTP 404/)
  })

  it('times out a server that never finishes', async () => {
    await expect(safeFetch(`http://a.test:${port}/slow`, { accept: 'html', timeoutMs: 300, resolve: async () => ['127.0.0.1'], ...local })).rejects.toThrow()
  })
})

describe('links', () => {
  it('extractUrls: distinct http(s) links; skips <url>, code, spoilers and internal links', () => {
    const body = [
      'see https://a.example/x?y=1, and (https://b.example/p_(q)). also https://a.example/x?y=1',
      '<https://skip.example/> `https://code.example` ||https://spoiler.example||',
      '```\nhttps://fence.example\n```', 'http://localhost:3000/c/abc/m/def', 'ftp://nope.example', '**https://bold.example**'
    ].join('\n')
    expect(extractUrls(body, 'http://localhost:3000')).toEqual(['https://a.example/x?y=1', 'https://b.example/p_(q)', 'https://bold.example/'])
  })
  it('composeBody: text, gif, or both (gif on its own line after the text)', () => {
    expect(composeBody(' hi ')).toBe('hi')
    expect(composeBody('', 'https://x/a.gif')).toBe('https://x/a.gif')
    expect(composeBody('hi', 'https://x/a.gif')).toBe('hi\nhttps://x/a.gif')
  })
  it('isImageUrl: https + image extension on any host', () => {
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
  it('parseHtml reads Open Graph data and makes the image absolute', async () => {
    const p = await parseHtml('<head><meta property="og:title" content="Hi"><meta property="og:description" content="D"><meta property="og:site_name" content="S"><meta property="og:image" content="/i.png"></head>', 'https://x.example/a/b')
    expect(p).toEqual({ title: 'Hi', description: 'D', siteName: 'S', image: 'https://x.example/i.png' })
  })
  it('mapGifs keeps order and skips entries without formats', () => {
    const r = mapGifs({ data: { has_next: true, data: [
      { id: 1, title: 'a', file: { md: { gif: { url: 'https://static.klipy.com/a.gif', width: 2, height: 3 } }, sm: { webp: { url: 'https://static.klipy.com/a.webp' } } } },
      { type: 'ad', content: '<script>' },
      { id: 2, title: 'b', file: { md: { gif: { url: 'https://static.klipy.com/b.gif' } } } }
    ] } })
    expect(r.hasNext).toBe(true)
    expect(r.items.map(i => [i.id, i.url, i.preview])).toEqual([['1', 'https://static.klipy.com/a.gif', 'https://static.klipy.com/a.webp'], ['2', 'https://static.klipy.com/b.gif', 'https://static.klipy.com/b.gif']])
  })
})

describe('preview storage', () => {
  let db: Db
  beforeEach(() => {
    db = createDb(':memory:')
    for (const id of ['a', 'b', 'c', 'admin']) db.insert(user).values({ id, name: id, email: `${id}@x.dev`, displayName: id }).run()
    db.insert(channels).values([{ id: 't', type: 'text', name: 't' }, { id: 'dm', type: 'dm' }]).run()
    db.insert(channelMembers).values([{ channelId: 'dm', userId: 'a' }, { channelId: 'dm', userId: 'b' }]).run()
  })
  const card = { title: 'T', description: 'D', siteName: 'S', imageKey: 'previews/k.webp' }

  it('caches by url with a TTL and shows cards on the message in order', () => {
    const m = createMessage(db, 'a', 't', 'https://x.example https://y.example')
    savePreview(db, 'https://y.example', card, 1000)
    savePreview(db, 'https://x.example', { ...card, imageKey: null }, 1000)
    expect(cachedPreview(db, 'https://x.example', 1000 + 1000)).toBeTruthy()
    expect(cachedPreview(db, 'https://x.example', 1000 + 8 * 24 * 3600_000)).toBeUndefined()
    const updated = attachPreviews(db, m.id, ['https://x.example', 'https://y.example'])!
    expect(updated.previews.map(p => [p.url, p.image])).toEqual([['https://x.example', false], ['https://y.example', true]])
    expect(listMessages(db, 't', {}).messages[0]!.previews.length).toBe(2)
    expect(attachPreviews(db, m.id, ['https://x.example'])).toBeNull() // nothing new
  })

  it('only the author or an admin removes a card, and it stays removed', () => {
    const m = createMessage(db, 'a', 't', 'https://x.example')
    savePreview(db, 'https://x.example', card)
    attachPreviews(db, m.id, ['https://x.example'])
    expect(() => removePreview(db, 'b', false, m.id, 'https://x.example')).toThrow(/author or an admin/)
    expect(removePreview(db, 'admin', true, m.id, 'https://x.example').previews).toEqual([])
    expect(attachPreviews(db, m.id, ['https://x.example'])).toBeNull() // a later job can't bring it back
  })

  it('editing away a link drops its card; deleting drops them all', () => {
    const m = createMessage(db, 'a', 't', 'https://x.example/ https://y.example/')
    for (const u of ['https://x.example/', 'https://y.example/']) savePreview(db, u, card)
    attachPreviews(db, m.id, ['https://x.example/', 'https://y.example/'])
    expect(editMessage(db, 'a', m.id, 'only https://y.example/').previews.map(p => p.url)).toEqual(['https://y.example/'])
    deleteMessage(db, 'a', false, m.id)
    expect(attachPreviews(db, m.id, ['https://y.example/'])).toBeNull()
  })

  it('thumbnails are served only to readers of the message', () => {
    const m = createMessage(db, 'a', 'dm', 'https://x.example')
    savePreview(db, 'https://x.example', card)
    attachPreviews(db, m.id, ['https://x.example'])
    expect(previewImageKey(db, 'b', m.id, 'https://x.example')).toBe('previews/k.webp')
    expect(previewImageKey(db, 'c', m.id, 'https://x.example')).toBeNull()
    expect(previewImageKey(db, 'b', m.id, 'https://other.example')).toBeNull()
  })
})
