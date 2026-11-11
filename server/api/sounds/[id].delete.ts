import { deleteSound } from '../../db/sounds'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const key = deleteSound(useDb(), getRouterParam(event, 'id')!)
  if (!key) throw createError({ statusCode: 404, message: 'Not found' })
  await r2Delete(useR2(), key).catch(e => console.error('[r2] could not delete sound', key, e))
  return { ok: true }
})
