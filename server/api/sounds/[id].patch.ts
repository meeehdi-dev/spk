import { updateSound } from '../../db/sounds'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  return asHttp(async () => {
    const { id, name, icon, durationMs } = updateSound(useDb(), getRouterParam(event, 'id')!, (await readBody(event)) ?? {})
    return { id, name, icon, durationMs }
  })
})
