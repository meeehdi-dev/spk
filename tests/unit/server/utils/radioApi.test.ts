import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dns = vi.hoisted(() => ({ srv: vi.fn(), ipv4: vi.fn(), ipv6: vi.fn() }))
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    resolveSrv = dns.srv
    resolve4 = dns.ipv4
    resolve6 = dns.ipv6
  },
}))

const id = '11111111-1111-4111-8111-111111111111'
const entry = (overrides = {}) => ({
  stationuuid: id,
  name: 'Station',
  url_resolved: 'https://stream.example.com/live',
  countrycode: 'FR',
  codec: 'MP3',
  hls: 0,
  lastcheckok: 1,
  ...overrides,
})
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
let request: ReturnType<typeof vi.fn>
let api: typeof import('~~/server/utils/radioApi')

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  dns.srv.mockResolvedValue([{ name: 'de1.api.radio-browser.info' }, { name: 'de2.api.radio-browser.info' }])
  dns.ipv4.mockResolvedValue(['8.8.8.8'])
  dns.ipv6.mockResolvedValue([])
  request = vi.fn(async () => json([entry()]))
  vi.stubGlobal('fetch', request)
  api = await import('~~/server/utils/radioApi')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Radio Browser native fetch API', () => {
  it('filters unsupported and unsafe streams, caps results, and caches searches', async () => {
    request.mockResolvedValueOnce(
      json([
        entry(),
        entry({ url_resolved: 'http://stream.example.com/live' }),
        entry({ hls: 1 }),
        entry({ codec: 'OGG' }),
        entry({ url_resolved: 'https://127.0.0.1/live' }),
        entry({ url_resolved: 'https://user:pass@stream.example.com' }),
        entry({ url_resolved: 'https://stream.example.com:8443/live' }),
        entry({ lastcheckok: 0 }),
        entry({ stationuuid: 'bad' }),
      ]),
    )
    expect(await api.searchRadioStations('test')).toEqual([{ id, name: 'Station', url: 'https://stream.example.com/live', country: 'FR', codec: 'MP3' }])
    expect(await api.searchRadioStations(' TEST ')).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(1)
    const url = new URL(request.mock.calls[0]![0] as string)
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('name')).toBe('test')
  })
  it('fails over after invalid JSON and reports unavailable mirrors', async () => {
    request.mockResolvedValueOnce(new Response('bad', { headers: { 'content-type': 'application/json' } }))
    expect(await api.searchRadioStations('test')).toHaveLength(1)
    request.mockRejectedValue(new Error('offline'))
    await expect(api.searchRadioStations('other')).rejects.toThrow('unavailable')
  })
  it('rejects oversized responses', async () => {
    request.mockImplementation(async () => json('a'.repeat(600_000)))
    await expect(api.searchRadioStations('test')).rejects.toThrow('unavailable')
  })
  it('does not use unexpected discovery hosts or follow directory redirects', async () => {
    dns.srv.mockResolvedValue([{ name: 'attacker.example.com' }])
    await expect(api.searchRadioStations('test')).rejects.toThrow('unavailable')
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects malformed searches and station ids before making requests', async () => {
    await expect(api.searchRadioStations('x')).rejects.toThrow('2–100')
    await expect(api.searchRadioStations('x'.repeat(101))).rejects.toThrow('2–100')
    await expect(api.getRadioStation('../other')).rejects.toThrow('identifier')
    expect(request).not.toHaveBeenCalled()
  })
  it('refreshes saved metadata in one bounded request without exposing stream URLs', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    request.mockResolvedValueOnce(json([entry(), entry({ stationuuid: other }), entry({ codec: 'OGG' })]))
    expect(await api.getRadioStationSummaries([id.toUpperCase()])).toEqual([{ id, name: 'Station', country: 'FR', codec: 'MP3' }])
    expect(new URL(request.mock.calls[0]![0] as string).searchParams.get('uuids')).toBe(id)
    expect(await api.getRadioStationSummaries([])).toEqual([])
    await expect(api.getRadioStationSummaries(['../bad'])).rejects.toThrow('identifiers')
    await expect(api.getRadioStationSummaries(Array(51).fill(id))).rejects.toThrow('identifiers')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('looks up a selected UUID and rejects private or mixed DNS answers', async () => {
    dns.ipv4.mockResolvedValue(['8.8.8.8', '10.0.0.1'])
    await expect(api.getRadioStation(id)).rejects.toThrow('public')
    dns.ipv4.mockResolvedValue(['8.8.8.8'])
    expect(await api.getRadioStation(id)).toMatchObject({ id, name: 'Station' })
  })
  it('rejects a mismatched station and DNS failure', async () => {
    request.mockResolvedValueOnce(json([entry({ stationuuid: '22222222-2222-4222-8222-222222222222' })]))
    await expect(api.getRadioStation(id)).rejects.toThrow('supported')
    dns.ipv4.mockRejectedValue(new Error('dns'))
    await expect(api.getRadioStation(id)).rejects.toThrow('public')
  })
})
