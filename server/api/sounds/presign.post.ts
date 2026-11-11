import { checkSoundSize, soundKey } from '../../db/sounds'
import { SOUND_MIME } from '../../../shared/utils/sounds'

// Body: { size }. Signs Content-Length and Content-Type audio/wav (at most 1.5 MB). Admin only.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return asHttp(async () => {
    const size = checkSoundSize((await readBody(event))?.size)
    const id = crypto.randomUUID()
    return { id, url: await presignPut(useR2(), soundKey(id), { size, type: SOUND_MIME }), headers: { 'content-type': SOUND_MIME } }
  })
})
