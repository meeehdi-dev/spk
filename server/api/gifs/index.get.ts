import { createHash } from 'node:crypto'

import { mapGifs } from '../../utils/klipy'
import { createLimiter } from '../../utils/limiter'

const allow = createLimiter(30, 60_000)

// ?q=<search> (empty = trending), ?page=. The Klipy key stays here; the browser only sees the result.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const key = useRuntimeConfig().klipyApiKey
  if (!key) throw createError({ statusCode: 503, statusMessage: 'GIFs are not set up' })
  if (!allow(u.id)) throw createError({ statusCode: 429, statusMessage: 'Slow down' })
  const q = String(getQuery(event).q ?? '')
    .trim()
    .slice(0, 100)
  const page = Math.min(Math.max(parseInt(String(getQuery(event).page ?? '1')) || 1, 1), 50)
  try {
    const json = await $fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${q ? 'search' : 'trending'}`, {
      query: { page, per_page: 24, ...(q ? { q } : {}), customer_id: createHash('sha256').update(u.id).digest('hex').slice(0, 32) },
      timeout: 5000,
    })
    return mapGifs(json)
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'GIF service unavailable' })
  }
})
