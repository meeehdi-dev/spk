import { parsePrefs, setPushPrefs } from '../../db/push'

// Updates the push settings of this browser's subscription.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const body = await readBody(event)
  if (typeof body?.endpoint !== 'string' || !body.endpoint) throw createError({ statusCode: 400, message: 'Invalid subscription' })
  setPushPrefs(useDb(), u.id, body.endpoint, parsePrefs(body.prefs))
  return { ok: true }
})
