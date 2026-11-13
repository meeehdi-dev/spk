import { randomUUID } from 'node:crypto'

const allow = createLimiter(10, 60_000) // presigns per user per minute

// Step 1: presigned PUT for the raw image. Step 2 (avatar.post) crops it and replaces it.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  const { size, type } = (await readBody<{ size?: number; type?: string }>(event)) ?? {}
  if (!type || !AVATAR_TYPES.includes(type)) throw createError({ statusCode: 400, message: 'Unsupported image type' })
  if (!Number.isInteger(size) || size! <= 0 || size! > AVATAR_MAX_UPLOAD) throw createError({ statusCode: 400, message: 'Image must be up to 5 MB' })
  const key = `avatars/raw/${u.id}/${randomUUID()}`
  return { key, url: await presignPut(useR2(), key, { size: size!, type }) }
})
