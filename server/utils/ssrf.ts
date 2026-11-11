// SSRF-guarded fetch for link previews. The host is resolved here, every address is checked, and the
// connection is made to that exact IP (Host header and TLS name stay the original host), so a DNS
// answer that changes between "check" and "connect" (rebinding) can't be used. Repeated for every redirect.
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

export class SsrfError extends Error {}

const blocklist = new net.BlockList()
for (const [a, p] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocklist.addSubnet(a, p, 'ipv4')
for (const [a, p] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocklist.addSubnet(a, p, 'ipv6')

/** True for anything that isn't a public unicast address (unparseable counts as blocked). */
export function isBlockedIp(ip: string): boolean {
  let v = net.isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname.slice(1, -1) : ip // canonical IPv6 form
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v) // IPv4-mapped IPv6
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16),
      lo = parseInt(mapped[2]!, 16)
    v = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  const family = net.isIP(v)
  return !family || blocklist.check(v, family === 4 ? 'ipv4' : 'ipv6')
}

export interface FetchOpts {
  /** What the response must be: HTML pages, images, or either. */
  accept: 'html' | 'image' | 'any'
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /** Test seams; the defaults are the real rules. */
  resolve?: (host: string) => Promise<string[]>
  allowIp?: (ip: string) => boolean
  allowPort?: (port: number) => boolean
}
export interface Fetched {
  url: string
  contentType: string
  body: Buffer
  truncated: boolean
}

const HTML = /^(text\/html|application\/xhtml\+xml)$/
const IMAGE = /^image\/(png|jpe?g|gif|webp|avif)$/
const defaultResolve = async (host: string) => (await dns.lookup(host, { all: true })).map(a => a.address)

/** Checks scheme, port, credentials and every resolved address; returns the IP to connect to. */
async function check(url: URL, o: FetchOpts) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('Only http and https links')
  if (url.username || url.password) throw new SsrfError('Links with credentials are not fetched')
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (!(o.allowPort ? o.allowPort(port) : port === 80 || port === 443)) throw new SsrfError('Port not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [host] : await (o.resolve ?? defaultResolve)(host)
  if (!addrs.length) throw new SsrfError('Host did not resolve')
  for (const a of addrs) if (!(o.allowIp ? o.allowIp(a) : !isBlockedIp(a))) throw new SsrfError('Address not allowed')
  return { ip: addrs[0]!, host, port }
}

function request(url: URL, t: { ip: string; host: string; port: number }, o: FetchOpts, signal: AbortSignal) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        host: t.ip,
        port: t.port,
        path: url.pathname + url.search,
        method: 'GET',
        agent: false,
        signal,
        servername: net.isIP(t.host) ? undefined : t.host,
        headers: {
          host: url.host,
          'user-agent': 'Mozilla/5.0 (compatible; spk-link-preview/1.0)',
          accept: o.accept === 'image' ? 'image/*' : 'text/html,application/xhtml+xml,image/*;q=0.8',
          'accept-encoding': 'identity', // no compression: the size limit counts real bytes
        },
      },
      resolve,
    )
    req.on('error', reject)
    req.end()
  })
}

export async function safeFetch(input: string, o: FetchOpts): Promise<Fetched> {
  const maxBytes = o.maxBytes ?? 1024 * 1024
  const signal = AbortSignal.timeout(o.timeoutMs ?? 5000) // one deadline for the whole chain, body included
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new SsrfError('Not a URL')
  }
  for (let hop = 0; ; hop++) {
    const res = await request(url, await check(url, o), o, signal)
    const status = res.statusCode ?? 0
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.resume()
      if (hop >= (o.maxRedirects ?? 3)) throw new SsrfError('Too many redirects')
      try {
        url = new URL(res.headers.location, url)
      } catch {
        throw new SsrfError('Bad redirect')
      }
      continue
    }
    if (status < 200 || status > 299) {
      res.resume()
      throw new SsrfError(`HTTP ${status}`)
    }
    const contentType = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    const isHtml = HTML.test(contentType),
      isImage = IMAGE.test(contentType)
    if (!((o.accept !== 'image' && isHtml) || (o.accept !== 'html' && isImage))) {
      res.destroy()
      throw new SsrfError('Content type not allowed')
    }
    const chunks: Buffer[] = []
    let size = 0,
      truncated = false
    for await (const c of res as AsyncIterable<Buffer>) {
      size += c.length
      if (size > maxBytes) {
        truncated = true
        res.destroy()
        break
      }
      chunks.push(c)
    }
    // A cut-off page still has its <head>; a cut-off image can't be decoded.
    if (truncated && isImage) throw new SsrfError('Image over the size limit')
    return { url: url.href, contentType, body: Buffer.concat(chunks), truncated }
  }
}
