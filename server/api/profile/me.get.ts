export default defineEventHandler(async event => {
  const u = await requireUser(event)
  return { id: u.id, email: u.email, role: u.role ?? 'user', displayName: u.displayName ?? null, avatarKey: u.avatarKey ?? null }
})
