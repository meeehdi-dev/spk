import { ChatError } from '../../db/messages'
import { checkSoundSize, soundKey } from '../../db/sounds'
import { SOUND_MIME } from '../../../shared/utils/sounds'

// Body: { size }. Signs Content-Length and Content-Type audio/wav (at most 1.5 MB). Admin only.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  try {
    const size = checkSoundSize((await readBody(event))?.size)
    const id = crypto.randomUUID()
    return { id, url: await presignPut(useR2(), soundKey(id), { size, type: SOUND_MIME }), headers: { 'content-type': SOUND_MIME } }
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
