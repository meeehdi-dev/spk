import type { GifItem } from '../../shared/utils/gifs'

import net from 'node:net'

import { createLimiter } from './limiter'
import { isBlockedIp } from './ssrf'

export const allowGifFavoriteWrite = createLimiter(30, 60_000)
export const isGifId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value)

function isGifUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || !/^https:\/\/\S+$/i.test(value)) return false
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      host.includes('.') &&
      !host.endsWith('.local') &&
      !host.endsWith('.localhost') &&
      !(net.isIP(host) && isBlockedIp(host))
    )
  } catch {
    return false
  }
}

export function gifFavoriteDto(id: string, value: unknown): GifItem | null {
  if (!value || typeof value !== 'object') return null
  const g = value as Record<string, unknown>
  if (typeof g.title !== 'string' || g.title.length > 500 || !isGifUrl(g.url) || !isGifUrl(g.preview)) return null
  if (
    typeof g.width !== 'number' ||
    !Number.isInteger(g.width) ||
    g.width < 0 ||
    g.width > 10000 ||
    typeof g.height !== 'number' ||
    !Number.isInteger(g.height) ||
    g.height < 0 ||
    g.height > 10000
  )
    return null
  return { id, title: g.title, url: g.url, preview: g.preview, width: g.width, height: g.height }
}
