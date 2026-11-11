/** False when the request carries an Origin that isn't the app's (no Origin = non-browser client, allowed). Dev allows any localhost. */
export function isSameOrigin(origin: string | null | undefined) {
  if (!origin) return true
  const app = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin
  if (origin === app) return true
  return import.meta.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}
