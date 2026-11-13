import type { RadioFavorite } from '../../../../shared/utils/radio'

import { listRadioFavorites } from '../../../db/radioFavorites'
import { createLimiter } from '../../../utils/limiter'
import { getRadioStationSummaries } from '../../../utils/radioApi'

const allowList = createLimiter(10, 60_000)

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  if (!allowList(user.id)) throw createError({ statusCode: 429, message: 'Too many favorites requests. Try again in a minute.' })
  const favorites = listRadioFavorites(useDb(), user.id)
  const stations = await getRadioStationSummaries(favorites.map(favorite => favorite.id)).catch(() => null)
  const current = new Map(stations?.map(station => [station.id, station]))
  return favorites
    .map((favorite): RadioFavorite => {
      const station = current.get(favorite.id)
      return { ...(station ?? favorite), available: stations === null ? null : !!station }
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
})
