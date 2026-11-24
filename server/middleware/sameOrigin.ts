// /api/hooks/ is exempt: the secret in the path is the auth and senders are servers.
// better-auth guards /api/auth itself; this covers the app's own write routes (e.g. from sibling subdomains).
export default defineEventHandler(event => {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(event.method) ||
    !event.path.startsWith('/api/') ||
    event.path.startsWith('/api/auth/') ||
    event.path.startsWith('/api/hooks/')
  )
    return
  if (!isSameOrigin(getRequestHeader(event, 'origin'))) throw createError({ statusCode: 403, message: 'Cross-origin request blocked' })
})
