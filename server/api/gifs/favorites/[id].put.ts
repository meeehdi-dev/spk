import { saveGifFavorite } from '../../../db/gifFavorites'
import { allowGifFavoriteWrite, gifFavoriteDto, isGifId } from '../../../utils/gifFavorites'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!isGifId(id)) throw createError({ statusCode: 400, message: 'Invalid GIF identifier' })
  if (!allowGifFavoriteWrite(user.id)) throw createError({ statusCode: 429, message: 'Too many favorites requests. Try again in a minute.' })
  const gif = gifFavoriteDto(id, await readBody(event))
  if (!gif) throw createError({ statusCode: 400, message: 'Invalid GIF metadata' })
  if (!saveGifFavorite(useDb(), user.id, gif)) throw createError({ statusCode: 409, message: 'You can save up to 50 GIF favorites.' })
  return gif
})
