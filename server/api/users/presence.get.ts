// userId -> 'online' | 'idle' for everyone with an open socket (offline users are absent).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return presenceSnapshot()
})
