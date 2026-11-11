// Who is in voice right now (clients also get live `voice:presence` frames).
export default defineEventHandler(async event => {
  await requireUser(event)
  return voiceSnapshot()
})
