import { createPendingAttachment } from '../../db/attachments'

const allow = createLimiter(40, 60_000) // presigns per user per minute

// Body: { filename, mime, size }. Signs Content-Length and Content-Type, so the PUT can't differ.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  const body = await readBody(event)
  return asHttp(async () => {
    const a = createPendingAttachment(useDb(), u.id, body ?? {})
    const url = await presignPut(useR2(), a.r2Key, { size: a.size, type: a.mime })
    return { id: a.id, url, headers: { 'content-type': a.mime } }
  })
})
