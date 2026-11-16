import { listGifFavorites } from '../../../db/gifFavorites'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  return listGifFavorites(useDb(), user.id)
})
