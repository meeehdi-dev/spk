export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userId } = await readBody<{ userId?: unknown }>(event) ?? {}
  if (typeof userId !== 'string' || !disconnectVoice(userId, 'An admin disconnected you from voice')) throw createError({ statusCode: 409, message: 'That user is not in voice' })
  return { ok: true }
})
