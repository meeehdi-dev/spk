import { previewImageKey } from '../../../db/previews'

// ?url=<card url>. Redirects to the thumbnail, only for readers of the message.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const key = previewImageKey(useDb(), u.id, getRouterParam(event, 'id'), getQuery(event).url)
  if (!key) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setResponseHeader(event, 'cache-control', 'private, max-age=600')
  return sendRedirect(event, await presignGet(useR2(), key, 900), 302)
})
