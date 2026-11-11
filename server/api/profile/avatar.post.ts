import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { user } from '../../db/schema'
import { AVATAR_MAX_UPLOAD, isAvatarRawKey, processAvatar } from '../../utils/avatar'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const { key: rawKey } = await readBody<{ key?: string }>(event)
  if (!isAvatarRawKey(u.id, rawKey)) throw createError({ statusCode: 400, statusMessage: 'Invalid upload key' })
  const r2 = useR2()
  let out: Uint8Array
  try {
    out = await processAvatar(await r2Get(r2, rawKey, AVATAR_MAX_UPLOAD))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Could not read that image' })
  } finally {
    await r2Delete(r2, rawKey).catch(() => {})
  }
  const key = `avatars/${u.id}/${randomUUID()}.webp`
  await r2Put(r2, key, out, 'image/webp')
  useDb().update(user).set({ avatarKey: key, updatedAt: new Date() }).where(eq(user.id, u.id)).run()
  if (u.avatarKey) await r2Delete(r2, u.avatarKey).catch(() => {})
  broadcast({ type: 'users:changed' })
  return { avatarKey: key }
})
