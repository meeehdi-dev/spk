import { sql } from 'drizzle-orm'

/** SQL condition: channel alias `c` is one `userId` may read. Text: everyone; DM and private webhook: members; public webhook (no member rows): everyone. */
export const readableChannel = (userId: string) => sql`(
  c.type = 'text'
  OR (c.type = 'dm' AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ${userId}))
  OR (c.type = 'webhook' AND (
    NOT EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id)
    OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ${userId})))
)`
