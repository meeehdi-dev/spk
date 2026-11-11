/** Path only: query strings and fragments can carry tokens (?invite=, ?token=), so they are never logged. */
export function safePath(url: string | undefined) {
  return (url ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0] || '/'
}

/**
 * One line per failure for `pnpm dev` / `docker logs`: method, path, status, message, user id. 5xx and unexpected errors add the stack.
 * Never pass bodies, headers or cookies: only these fields are printed.
 */
export function logFailure(f: { method?: string; url?: string; status: number; message?: string; userId?: string | null; error?: unknown }) {
  const who = f.userId ? ` user=${f.userId}` : ''
  console.error(`[error] ${f.method ?? '-'} ${safePath(f.url)} ${f.status} ${f.message ?? ''}${who}`.trimEnd())
  const stack = (f.error as Error | undefined)?.stack
  if (f.status >= 500 && stack) console.error(stack)
}

/** Background work (no request): scope, message and stack. */
export function logBackground(scope: string, error: unknown) {
  const e = error as Error | undefined
  console.error(`[error] ${scope}: ${e?.message ?? String(error)}`)
  if (e?.stack) console.error(e.stack)
}
