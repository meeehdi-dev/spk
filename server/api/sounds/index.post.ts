import { ChatError } from '../../db/messages'
import { createSound, soundKey } from '../../db/sounds'

// Saves the row after the browser uploaded the WAV: the object must exist with the announced size. Admin only.
export default defineEventHandler(async (event) => {
  const u = await requireAdmin(event)
  const body = (await readBody(event)) ?? {}
  try {
    const uploaded = typeof body.id === 'string' && /^[0-9a-f-]{36}$/.test(body.id) ? await r2Size(useR2(), soundKey(body.id)) : null
    const { id, name, icon, durationMs, size } = createSound(useDb(), u.id, body, uploaded)
    return { id, name, icon, durationMs, size }
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
