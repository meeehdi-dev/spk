import type { RadioStation } from '../../shared/utils/radio'

import { Resolver } from 'node:dns/promises'
import net from 'node:net'

import { isBlockedIp } from './ssrf'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const resolver = new Resolver({ timeout: 2000, tries: 1 })
let servers: { names: string[]; expires: number } | undefined
const searches = new Map<string, { stations: RadioStation[]; expires: number }>()

export const isStationId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** Directory fields are untrusted. Only direct HTTPS MP3/AAC streams are supported. */
function stationDto(value: unknown): RadioStation | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  if (!isStationId(s.stationuuid) || typeof s.name !== 'string' || !s.name.trim() || typeof s.url_resolved !== 'string' || s.url_resolved.length > 4096)
    return null
  if (s.lastcheckok !== 1 || s.hls !== 0 || typeof s.codec !== 'string' || !['MP3', 'AAC', 'AAC+'].includes(s.codec.toUpperCase())) return null
  try {
    const url = new URL(s.url_resolved)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || (net.isIP(host) && isBlockedIp(host))) return null
    return {
      id: s.stationuuid.toLowerCase(),
      name: s.name.trim().slice(0, 200),
      url: url.href,
      country: String(s.countrycode ?? '').slice(0, 2),
      codec: s.codec,
    }
  } catch {
    return null
  }
}

async function apiServers() {
  if (servers && servers.expires > Date.now()) return servers.names
  const records = await resolver.resolveSrv('_api._tcp.radio-browser.info')
  const names = [...new Set(records.map(r => r.name.replace(/\.$/, '').toLowerCase()).filter(n => /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(n)))]
  if (!names.length) throw new Error('Radio directory is unavailable')
  // Rotate the starting server so requests do not all target the same mirror.
  const offset = Math.floor(Math.random() * names.length)
  servers = { names: [...names.slice(offset), ...names.slice(0, offset)], expires: Date.now() + 300_000 }
  return servers.names
}

/** Native fetch only. API paths are built here, never supplied by the browser. */
async function radioRequest(path: string): Promise<unknown> {
  for (const host of (await apiServers()).slice(0, 2)) {
    try {
      const response = await fetch(`https://${host}${path}`, {
        headers: { accept: 'application/json', 'user-agent': 'spk-radio/1.0 (https://github.com/meeehdi-dev/spk)' },
        signal: AbortSignal.timeout(4000),
        redirect: 'error',
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) {
        await response.body?.cancel()
        continue
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 512 * 1024) throw new Error('Radio directory response is too large')
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      // Try another discovered mirror, including on malformed or oversized responses.
    }
  }
  servers = undefined
  throw new Error('Radio directory is unavailable. Try again later.')
}

export async function searchRadioStations(query: string): Promise<RadioStation[]> {
  const key = query.trim().toLowerCase()
  if (key.length < 2 || key.length > 100) throw new Error('Search must contain 2–100 characters')
  const cached = searches.get(key)
  if (cached && cached.expires > Date.now()) return cached.stations
  const params = new URLSearchParams({ name: key, hidebroken: 'true', limit: '20', order: 'clickcount', reverse: 'true', is_https: 'true' })
  const data = await radioRequest(`/json/stations/search?${params}`)
  if (!Array.isArray(data)) throw new Error('Radio directory returned invalid data')
  const stations = data
    .slice(0, 20)
    .map(stationDto)
    .filter((s): s is RadioStation => !!s)
  for (const [k, v] of searches) if (v.expires <= Date.now()) searches.delete(k)
  if (searches.size >= 50) searches.delete(searches.keys().next().value!)
  searches.set(key, { stations, expires: Date.now() + 60_000 })
  return stations
}

export async function getRadioStation(id: string): Promise<RadioStation> {
  if (!isStationId(id)) throw new Error('Invalid station identifier')
  const data = await radioRequest(`/json/stations/byuuid/${id}`)
  const station = Array.isArray(data) ? stationDto(data[0]) : null
  if (!station || station.id !== id.toLowerCase()) throw new Error('This station is not a supported HTTPS audio stream')
  const host = new URL(station.url).hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(host) ? [host] : [...(await resolver.resolve4(host).catch(() => [])), ...(await resolver.resolve6(host).catch(() => []))]
  if (!addresses.length || addresses.some(isBlockedIp)) throw new Error('This station does not have a public stream address')
  return station
}

/** Radio Browser requests one click report when a user selects a station, not per listener. */
export async function countRadioClick(id: string) {
  if (isStationId(id)) await radioRequest(`/json/url/${id}`).catch(() => {})
}
