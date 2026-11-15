import { fetchChangelog } from '../utils/changelog'

export default defineEventHandler(async event => {
  await requireUser(event)
  const { page = '1', head = 'main' } = getQuery(event)
  if (
    typeof page !== 'string' ||
    !/^[1-9]\d*$/.test(page) ||
    !Number.isSafeInteger(Number(page)) ||
    typeof head !== 'string' ||
    (head !== 'main' && !/^[a-f0-9]{40}$/.test(head)) ||
    (page !== '1' && head === 'main')
  )
    throw createError({ statusCode: 400, message: 'Invalid changelog pagination' })
  try {
    return await fetchChangelog(Number(page), head)
  } catch {
    throw createError({ statusCode: 503, message: 'Changelog is unavailable. Try again later.' })
  }
})
