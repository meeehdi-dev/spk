import type { AddressInfo } from 'node:net'

import http from 'node:http'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { isBlockedIp, safeFetch, SsrfError } from '~~/server/utils/ssrf'

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
    'ff02::1',
    'not-an-ip',
  ])('blocks %s', ip => expect(isBlockedIp(ip)).toBe(true))
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', ip =>
    expect(isBlockedIp(ip)).toBe(false),
  )
})

describe('safeFetch', () => {
  let server: http.Server
  let port: number
  const hits: string[] = []
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(`${req.headers.host}${req.url}`)
      const url = req.url!
      if (url === '/page') {
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end('<title>x</title>')
      } else if (url === '/big') {
        res.setHeader('content-type', 'text/html')
        res.end('a'.repeat(5000))
      } else if (url === '/json') {
        res.setHeader('content-type', 'application/json')
        res.end('{}')
      } else if (url === '/img') {
        res.setHeader('content-type', 'image/png')
        res.end(Buffer.alloc(5000))
      } else if (url === '/loop') {
        res.statusCode = 302
        res.setHeader('location', '/loop')
        res.end()
      } else if (url === '/to-private') {
        res.statusCode = 302
        res.setHeader('location', 'http://internal.test/secret')
        res.end()
      } else if (url === '/slow') {
        res.setHeader('content-type', 'text/html')
        res.write('<title>') /* never ends */
      } else if (url === '/redir') {
        res.statusCode = 301
        res.setHeader('location', '/page')
        res.end()
      } else {
        res.statusCode = 404
        res.end()
      }
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  beforeEach(() => {
    hits.length = 0
  })

  // The test server is on loopback, so the real IP rule is swapped for "only 127.0.0.1" and the port rule for its port.
  const local = { allowIp: (ip: string) => ip === '127.0.0.1', allowPort: (p: number) => p === port }
  const pub = { resolve: async () => ['93.184.216.34'] }

  it('rejects non-http schemes, bad ports, credentials and private/loopback literals (defaults)', async () => {
    for (const u of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'gopher://x/',
      'javascript:alert(1)',
      'http://example.com:8080/',
      'https://example.com:22/',
      'http://user:pw@example.com/',
      'http://127.0.0.1/',
      'http://127.0.0.1:80/',
      'http://10.0.0.5/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://0.0.0.0/',
      'http://2130706433/',
      'http://0x7f.1/',
    ]) {
      await expect(safeFetch(u, { accept: 'html', ...pub }), u).rejects.toBeInstanceOf(SsrfError)
    }
    expect(hits).toEqual([])
  })

  it('rejects a name when any of its addresses is private, without connecting', async () => {
    await expect(safeFetch('http://rebind.test/', { accept: 'html', resolve: async () => ['93.184.216.34', '10.0.0.1'] })).rejects.toThrow(
      /Address not allowed/,
    )
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
    await expect(safeFetch(`http://pub.test:${port}/to-private`, { accept: 'html', resolve, ...local, allowPort: () => true })).rejects.toThrow(
      /Address not allowed/,
    )
    expect(hits).toEqual([`pub.test:${port}/to-private`])
    const ok = await safeFetch(`http://pub.test:${port}/redir`, { accept: 'html', resolve, ...local })
    expect(ok.url).toBe(`http://pub.test:${port}/page`)
  })

  it('stops after too many redirects', async () => {
    await expect(safeFetch(`http://pub.test:${port}/loop`, { accept: 'html', resolve: async () => ['127.0.0.1'], ...local })).rejects.toThrow(
      /Too many redirects/,
    )
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
