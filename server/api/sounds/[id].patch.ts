import { ChatError } from '../../db/messages'
import { updateSound } from '../../db/sounds'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  try {
    const { id, name, icon, durationMs } = updateSound(useDb(), getRouterParam(event, 'id')!, (await readBody(event)) ?? {})
    return { id, name, icon, durationMs }
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
