import { cancelPending } from '../../../db/attachments'
import { retryObjectDeletions } from '../../../db/objectDeletions'

// Cancel or remove one of your own unsent uploads (row and object).
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const key = cancelPending(useDb(), u.id, getRouterParam(event, 'id')!)
  if (key) {
    const c = useR2()
    await retryObjectDeletions(useDb(), k => r2Delete(c, k), Date.now(), [key])
  }
  return { ok: true }
})
