import { listPins } from '../../../db/pins'

export default defineEventHandler(async event => {
  const u = await requireUser(event)
  return asHttp(() => listPins(useDb(), u.id, getRouterParam(event, 'id')!))
})
