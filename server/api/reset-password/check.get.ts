import { checkResetToken } from '../../db/reset'

export default defineEventHandler((event) => {
  const token = String(getQuery(event).token ?? '')
  return { valid: !!token && checkResetToken(useDb(), token) }
})
