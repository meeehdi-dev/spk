import { user } from '../../db/schema'

// Directory of nicknames for rendering authors and mentions. No emails.
export default defineEventHandler(async event => {
  await requireUser(event)
  return useDb().select({ id: user.id, displayName: user.displayName, avatarKey: user.avatarKey, role: user.role, banned: user.banned }).from(user).all()
})
