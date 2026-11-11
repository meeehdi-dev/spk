import { accessibleChannel } from '../../../db/messages'
import { markUnreadFrom, readState } from '../../../db/reads'

// Body { messageId }: that message and everything after it become unread.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const db = useDb()
  const id = getRouterParam(event, 'id')!
  if (!accessibleChannel(db, u.id, id)) throw createError({ statusCode: 403, statusMessage: 'No access to this channel' })
  if (!markUnreadFrom(db, u.id, id, (await readBody(event))?.messageId)) throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  const state = readState(db, u.id, id)
  sendToUser(u.id, { type: 'unread:update', channelId: id, ...state })
  return state
})
