import { getSound } from '../../../db/sounds'

// Short-lived presigned GET for the sound's WAV ({ url }). Any signed-in user.
export default defineEventHandler(async event => {
  await requireUser(event)
  const s = getSound(useDb(), getRouterParam(event, 'id')!)
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return { url: await presignGet(useR2(), s.r2Key, 900) }
})
