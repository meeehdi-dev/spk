import { accessibleChannel, listMessages } from '../../../db/messages'
import { firstUnreadId } from '../../../db/reads'

// ?unread=1 (latest page plus firstUnreadId, for the "New messages" divider)
// ?before=<id> (older page), ?after=<id> (newer page), ?around=<id> (jump), ?limit=
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const db = useDb()
  const id = getRouterParam(event, 'id')!
  if (!accessibleChannel(db, u.id, id)) throw createError({ statusCode: 403, message: 'No access to this channel' })
  const q = getQuery(event)
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return asHttp(() => {
    if (q.unread) {
      return { ...listMessages(db, id, {}), firstUnreadId: firstUnreadId(db, u.id, id) }
    }
    return listMessages(db, id, { before: str(q.before), after: str(q.after), around: str(q.around), limit: Number(q.limit) || undefined })
  })
})
