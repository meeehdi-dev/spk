import { accessibleChannel, listMessages } from '../../../db/messages'
import { firstUnreadId } from '../../../db/reads'

// ?unread=1 (open at the first unread message, returns firstUnreadId)
// ?before=<id> (older page), ?after=<id> (newer page), ?around=<id> (jump), ?limit=
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const db = useDb()
  const id = getRouterParam(event, 'id')!
  if (!accessibleChannel(db, u.id, id)) throw createError({ statusCode: 403, message: 'No access to this channel' })
  const q = getQuery(event)
  const str = (v: unknown) => typeof v === 'string' && v ? v : undefined
  return asHttp(() => {
    if (q.unread) {
      const first = firstUnreadId(db, u.id, id)
      return { ...listMessages(db, id, first ? { around: first } : {}), firstUnreadId: first }
    }
    return listMessages(db, id, { before: str(q.before), after: str(q.after), around: str(q.around), limit: Number(q.limit) || undefined })
  })
})
