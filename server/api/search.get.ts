import { searchMessages } from '../db/search'

const allow = createLimiter(60, 60_000)

// ?q=&scope=channel|channels|dms|everything&channelId=&cursor=  (20 per page)
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  const q = getQuery(event)
  return asHttp(() => searchMessages(useDb(), u.id, q))
})
