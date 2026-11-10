import { and, eq } from 'drizzle-orm'
import { channels } from '../../db/schema'

// Only real voice channels get a token.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const { channelId } = await readBody<{ channelId?: unknown }>(event) ?? {}
  const ch = typeof channelId === 'string'
    ? useDb().select({ id: channels.id }).from(channels).where(and(eq(channels.id, channelId), eq(channels.type, 'voice'))).get()
    : undefined
  if (!ch) throw createError({ statusCode: 404, statusMessage: 'Voice channel not found' })
  const cfg = useRuntimeConfig()
  if (!cfg.livekit.apiKey || !cfg.livekit.apiSecret || !cfg.public.livekitUrl) throw createError({ statusCode: 503, statusMessage: 'Voice is not configured' })
  const token = await createVoiceToken({ apiKey: cfg.livekit.apiKey, apiSecret: cfg.livekit.apiSecret, userId: u.id, name: u.displayName || u.name, channelId: ch.id })
  return { token, url: cfg.public.livekitUrl }
})
