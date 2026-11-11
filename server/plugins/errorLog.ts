import { logFailure } from '../utils/errorLog'

// Nitro reports every thrown error (4xx and 5xx) here; without it a failed request leaves no trace in the server log.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500
    logFailure({
      method: event?.method, url: event?.path, status,
      message: (error as { statusMessage?: string }).statusMessage || error.message,
      userId: event?.context.userId as string | undefined, error: status >= 500 ? (error.cause ?? error) : undefined,
    })
  })
})
