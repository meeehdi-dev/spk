import { removePush, savePush, setPushPrefs } from '../../db/push'

// POST: save this browser's push subscription + settings. PUT: update settings. DELETE: unsubscribe.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const body = await readBody(event)
  const db = useDb()
  const prefs = {
    dms: body?.prefs?.dms !== false,
    pings: body?.prefs?.pings !== false,
    dnd: !!body?.prefs?.dnd,
    muted: Array.isArray(body?.prefs?.muted) ? body.prefs.muted.filter((x: unknown) => typeof x === 'string') : [],
  }
  if (event.method === 'POST') {
    const s = body?.subscription
    if (typeof s?.endpoint !== 'string' || !s.endpoint.startsWith('https://') || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'Invalid subscription' })
    }
    savePush(db, u.id, s.endpoint, { p256dh: s.keys.p256dh, auth: s.keys.auth }, prefs)
  } else if (event.method === 'PUT') setPushPrefs(db, u.id, prefs)
  else if (event.method === 'DELETE') removePush(db, String(body?.endpoint), u.id)
  else throw createError({ statusCode: 405 })
  return { ok: true }
})
