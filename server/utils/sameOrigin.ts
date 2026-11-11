import { appOrigin } from './appOrigin'
/** False when the request carries an Origin that isn't the app's (no Origin = non-browser client, allowed). Dev allows any localhost. */
export function isSameOrigin(origin: string | null | undefined) {
  if (!origin) return true
  const app = appOrigin()
  if (origin === app) return true
  return import.meta.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}
