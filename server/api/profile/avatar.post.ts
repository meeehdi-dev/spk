import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { user } from '../../db/schema'

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
  // Read the current key right before the update (synchronous, no interleaving), not the session's possibly stale one.
  const db = useDb()
  const prev = db.select({ k: user.avatarKey }).from(user).where(eq(user.id, u.id)).get()?.k
  db.update(user).set({ avatarKey: key, updatedAt: new Date() }).where(eq(user.id, u.id)).run()
  if (prev) await r2Delete(r2, prev).catch(() => {})
  broadcast({ type: 'users:changed' })
  return { avatarKey: key }
})
