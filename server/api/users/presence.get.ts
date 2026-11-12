// userId -> 'online' | 'idle' | 'busy' for everyone with an open socket (offline and invisible users are absent).
export default defineEventHandler(async event => {
  await requireUser(event)
  return presenceSnapshot()
})
