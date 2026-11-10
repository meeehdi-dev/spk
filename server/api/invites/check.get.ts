import { checkInvite } from '../../db/invites'

export default defineEventHandler((event) => {
  const token = String(getQuery(event).token ?? '')
  const status = token ? checkInvite(useDb(), token) : 'invalid'
  return { valid: status === 'active', reason: status === 'active' ? null : status }
})
