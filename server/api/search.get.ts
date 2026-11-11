import { ChatError } from '../db/messages'
import { searchMessages } from '../db/search'
import { createLimiter } from '../utils/limiter'

const allow = createLimiter(60, 60_000)

// ?q=&scope=channel|channels|dms|everything&channelId=&cursor=  (20 per page)
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, statusMessage: 'Slow down' })
  const q = getQuery(event)
  try {
    return searchMessages(useDb(), u.id, q)
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
