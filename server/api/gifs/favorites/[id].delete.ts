import { removeGifFavorite } from '../../../db/gifFavorites'
import { allowGifFavoriteWrite, isGifId } from '../../../utils/gifFavorites'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!isGifId(id)) throw createError({ statusCode: 400, message: 'Invalid GIF identifier' })
  if (!allowGifFavoriteWrite(user.id)) throw createError({ statusCode: 429, message: 'Too many favorites requests. Try again in a minute.' })
  removeGifFavorite(useDb(), user.id, id)
  return { ok: true }
})
