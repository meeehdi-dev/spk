import { allUnread } from '../db/reads'

export default defineEventHandler(async (event) => allUnread(useDb(), (await requireUser(event)).id))
