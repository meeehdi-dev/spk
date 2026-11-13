import { createError } from 'h3'
import { vi } from 'vitest'

/** Stubs the Nitro auto-imports a handler module reads at import time, plus any extra globals. */
export function stubNitro(globals: Record<string, unknown> = {}) {
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('createError', createError)
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)
}

/** A `requireUser` stub that rejects with 401 when the current id is null. */
export const requireUserAs = (current: () => string | null) => async () => {
  const id = current()
  if (!id) throw createError({ statusCode: 401 })
  return { id }
}
