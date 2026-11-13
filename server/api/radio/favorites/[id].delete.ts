import { removeRadioFavorite } from '../../../db/radioFavorites'
import { isStationId } from '../../../utils/radioApi'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!isStationId(id)) throw createError({ statusCode: 400, message: 'Invalid station identifier' })
  removeRadioFavorite(useDb(), user.id, id.toLowerCase())
  return { ok: true }
})
