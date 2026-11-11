import { cancelPending } from '../../../db/attachments'

// Cancel or remove one of your own unsent uploads (row and object).
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const key = cancelPending(useDb(), u.id, getRouterParam(event, 'id')!)
  if (key) {
    const c = useR2()
    r2Delete(c, key).catch(() => {})
  } // an orphan sweep can't see it any more; a failed delete is rare
  return { ok: true }
})
