import { and, eq } from 'drizzle-orm'
import { channels } from '../../../db/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userId, channelId } = await readBody<{ userId?: unknown, channelId?: unknown }>(event) ?? {}
  const ch = typeof channelId === 'string' ? useDb().select({ id: channels.id }).from(channels).where(and(eq(channels.id, channelId), eq(channels.type, 'voice'))).get() : undefined
  if (!ch) throw createError({ statusCode: 404, statusMessage: 'Voice channel not found' })
  if (typeof userId !== 'string' || !moveVoice(userId, ch.id)) throw createError({ statusCode: 409, statusMessage: 'That user is not in another voice channel' })
  return { ok: true }
})
