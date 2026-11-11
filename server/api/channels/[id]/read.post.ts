import { accessibleChannel } from '../../../db/messages'
import { markRead, readState } from '../../../db/reads'

export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const db = useDb()
  const id = getRouterParam(event, 'id')!
  if (!accessibleChannel(db, u.id, id)) throw createError({ statusCode: 403, statusMessage: 'No access to this channel' })
  markRead(db, u.id, id)
  const state = readState(db, u.id, id)
  sendToUser(u.id, { type: 'unread:update', channelId: id, ...state }) // other tabs
  return state
})
