import { listUsersWithStorage } from '../../db/admin'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return listUsersWithStorage(useDb())
})
