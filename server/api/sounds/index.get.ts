import { listSounds } from '../../db/sounds'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listSounds(useDb())
})
