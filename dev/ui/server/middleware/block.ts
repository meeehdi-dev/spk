import { createError, defineEventHandler, getRequestURL } from 'h3'

// The sandbox has no application backend, database, auth routes, or LiveKit endpoint.
export default defineEventHandler(event => {
  const path = getRequestURL(event).pathname
  if (path === '/api' || path.startsWith('/api/') || path === '/_ws') {
    throw createError({ statusCode: 501, statusMessage: 'UI sandbox requests must be handled locally' })
  }
})
