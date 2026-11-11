import { listChannelsFor } from '../../db/dms'

// Text channels, then the caller's own DMs.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  return listChannelsFor(useDb(), u.id)
})
