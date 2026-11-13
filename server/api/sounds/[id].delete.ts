import { retryObjectDeletions } from '../../db/objectDeletions'
import { deleteSound } from '../../db/sounds'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const key = deleteSound(useDb(), getRouterParam(event, 'id')!)
  if (!key) throw createError({ statusCode: 404, message: 'Not found' })
  const { failed } = await retryObjectDeletions(useDb(), k => r2Delete(useR2(), k), Date.now(), [key])
  if (failed.length) console.error('[r2] could not delete sound', failed)
  return { ok: true }
})
