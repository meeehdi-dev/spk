import { parsePrefs, savePush } from '../../db/push'

// Saves this browser's push subscription + settings.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const body = await readBody(event)
  const s = body?.subscription
  if (typeof s?.endpoint !== 'string' || !s.endpoint.startsWith('https://') || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') {
    throw createError({ statusCode: 400, message: 'Invalid subscription' })
  }
  savePush(useDb(), u.id, s.endpoint, { p256dh: s.keys.p256dh, auth: s.keys.auth }, parsePrefs(body?.prefs))
  return { ok: true }
})
