import { desc, eq } from 'drizzle-orm'

import { inviteStatus } from '../../db/invites'
import { invites, user } from '../../db/schema'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const rows = useDb()
    .select({ i: invites, usedByName: user.displayName, usedByEmail: user.email })
    .from(invites)
    .leftJoin(user, eq(user.id, invites.usedBy))
    .orderBy(desc(invites.createdAt))
    .all()
  return rows.map(({ i, usedByName, usedByEmail }) => ({
    id: i.id,
    note: i.note,
    createdAt: i.createdAt.getTime(),
    expiresAt: i.expiresAt.getTime(),
    status: inviteStatus(i),
    usedBy: i.usedBy ? { id: i.usedBy, name: usedByName ?? usedByEmail } : null,
  }))
})
