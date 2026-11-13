import { randomUUID } from 'node:crypto'

import { replaceAvatar, retryObjectDeletions } from '../../db/objectDeletions'

export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const { key: rawKey } = (await readBody<{ key?: string }>(event)) ?? {}
  if (!isAvatarRawKey(u.id, rawKey)) throw createError({ statusCode: 400, message: 'Invalid upload key' })
  const r2 = useR2()
  let out: Uint8Array
  try {
    out = await processAvatar(await r2Get(r2, rawKey, AVATAR_MAX_UPLOAD))
  } catch {
    throw createError({ statusCode: 400, message: 'Could not read that image' })
  } finally {
    await r2Delete(r2, rawKey).catch(() => {})
  }
  const key = `avatars/${u.id}/${randomUUID()}.webp`
  await r2Put(r2, key, out, 'image/webp')
  const db = useDb()
  const prev = replaceAvatar(db, u.id, key)
  if (prev) await retryObjectDeletions(db, k => r2Delete(r2, k), Date.now(), [prev])
  broadcast({ type: 'users:changed' })
  return { avatarKey: key }
})
