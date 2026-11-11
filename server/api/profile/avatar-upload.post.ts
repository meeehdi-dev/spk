import { randomUUID } from 'node:crypto'

// Step 1: presigned PUT for the raw image. Step 2 (avatar.post) crops it and replaces it.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const { size, type } = await readBody<{ size?: number, type?: string }>(event) ?? {}
  if (!type || !AVATAR_TYPES.includes(type)) throw createError({ statusCode: 400, message: 'Unsupported image type' })
  if (!Number.isInteger(size) || size! <= 0 || size! > AVATAR_MAX_UPLOAD) throw createError({ statusCode: 400, message: 'Image must be up to 5 MB' })
  const key = `avatars/raw/${u.id}/${randomUUID()}`
  return { key, url: await presignPut(useR2(), key, { size: size!, type }) }
})
