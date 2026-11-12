import { createLimiter } from '../../utils/limiter'
import { searchRadioStations } from '../../utils/radioApi'

const allowSearch = createLimiter(10, 60_000)

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  if (!allowSearch(user.id)) throw createError({ statusCode: 429, message: 'Too many radio searches. Try again in a minute.' })
  const q = getQuery(event).q
  if (typeof q !== 'string' || q.trim().length < 2 || q.trim().length > 100) {
    throw createError({ statusCode: 400, message: 'Search must contain 2–100 characters' })
  }
  try {
    return await searchRadioStations(q)
  } catch {
    throw createError({ statusCode: 503, message: 'Radio directory is unavailable. Try again later.' })
  }
})
