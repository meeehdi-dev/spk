import { removePush } from '../../db/push'

// Unsubscribes this browser.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const body = await readBody(event)
  removePush(useDb(), String(body?.endpoint), u.id)
  return { ok: true }
})
