
// better-auth guards /api/auth itself; this covers the app's own write routes (e.g. from sibling subdomains).
export default defineEventHandler((event) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(event.method) || !event.path.startsWith('/api/') || event.path.startsWith('/api/auth/')) return
  if (!isSameOrigin(getRequestHeader(event, 'origin'))) throw createError({ statusCode: 403, message: 'Cross-origin request blocked' })
})
