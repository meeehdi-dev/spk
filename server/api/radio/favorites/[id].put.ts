import { saveRadioFavorite } from '../../../db/radioFavorites'
import { createLimiter } from '../../../utils/limiter'
import { getRadioStation, isStationId } from '../../../utils/radioApi'

const allowSave = createLimiter(10, 60_000)

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!isStationId(id)) throw createError({ statusCode: 400, message: 'Invalid station identifier' })
  if (!allowSave(user.id)) throw createError({ statusCode: 429, message: 'Too many favorites requests. Try again in a minute.' })
  const station = await getRadioStation(id.toLowerCase()).catch(() => {
    throw createError({ statusCode: 503, message: 'This station is unavailable. Try again later.' })
  })
  if (!saveRadioFavorite(useDb(), user.id, station)) throw createError({ statusCode: 409, message: 'You can save up to 50 radio favorites.' })
  const { url: _url, ...favorite } = station
  return { ...favorite, available: true }
})
