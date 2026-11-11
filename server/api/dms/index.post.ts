import { openDm } from '../../db/dms'

// Opens (or creates) the 1:1 DM with another user.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const body = await readBody(event)
  return asHttp(() => openDm(useDb(), u.id, body?.userId))
})
