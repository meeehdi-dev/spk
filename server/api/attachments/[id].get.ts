import { and, eq, isNull } from 'drizzle-orm'

import { accessibleChannel } from '../../db/messages'
import { attachments, messages } from '../../db/schema'

// Redirects to a short-lived presigned GET. Only for sent attachments of messages the user may read.
// ?json=1 answers { url } instead (for fetch with a Range header, which can't follow a cross-origin redirect safely).
// ?download=1 forces a download with the original file name.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const db = useDb()
  const row = db
    .select({ key: attachments.r2Key, filename: attachments.filename, channelId: messages.channelId })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(eq(attachments.id, getRouterParam(event, 'id')!), isNull(messages.deletedAt)))
    .get()
  if (!row || !accessibleChannel(db, u.id, row.channelId)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const download = getQuery(event).download
  const url = await presignGet(useR2(), row.key, 900, download ? `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}` : undefined)
  if (getQuery(event).json) return { url }
  setResponseHeader(event, 'cache-control', 'private, max-age=600')
  return sendRedirect(event, url, 302)
})
