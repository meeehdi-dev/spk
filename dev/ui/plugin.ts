import { defineNuxtPlugin, refreshNuxtData } from '#imports'

import { onScenarioReset, responseDelay, SandboxError, sandboxApi } from './fixtures'

/** Requires the sandbox's dynamic-fetch template and auth-client alias; install before router middleware. */
export function installSandboxTransport() {
  const originalFetch = globalThis.fetch
  const originalWindowFetch = window.fetch
  const original$Fetch = globalThis.$fetch
  const sandboxFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const url = new URL(request?.url ?? String(input), globalThis.location?.origin ?? 'http://localhost')
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (responseDelay.value) await new Promise(resolve => setTimeout(resolve, responseDelay.value))
      try {
        const raw = init?.body ?? (request && method !== 'GET' && method !== 'HEAD' ? await request.clone().text() : undefined)
        const body: unknown = typeof raw === 'string' && raw ? JSON.parse(raw) : (raw ?? {})
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxError(400, 'Expected a JSON object')
        const result = sandboxApi(url, method, body as Record<string, unknown>)
        return Response.json(result)
      } catch (e) {
        const statusCode = e instanceof SandboxError ? e.statusCode : 400
        const statusMessage = e instanceof Error ? e.message : 'Sandbox request failed'
        return Response.json({ statusCode, statusMessage, message: statusMessage }, { status: statusCode })
      }
    }
    // Asset/module GETs still work, but no unsupported mutation can touch a real service.
    if (method !== 'GET' && method !== 'HEAD') return Response.json({ statusMessage: 'Mutations are blocked in UI sandbox' }, { status: 501 })
    return originalFetch(input, init)
  }
  globalThis.fetch = sandboxFetch
  window.fetch = sandboxFetch
  // Nuxt's typed facade omits ofetch's runtime-supported second create argument.
  const create = original$Fetch.create as (defaults: { retry: number }, globals: { fetch: typeof fetch }) => typeof original$Fetch
  globalThis.$fetch = create({ retry: 0 }, { fetch: sandboxFetch })
  return () => {
    globalThis.fetch = originalFetch
    window.fetch = originalWindowFetch
    globalThis.$fetch = original$Fetch
  }
}

export default defineNuxtPlugin({
  name: 'ui-sandbox-transport',
  enforce: 'pre',
  order: -1000,
  setup() {
    installSandboxTransport()
    onScenarioReset(() => {
      void refreshNuxtData()
    })
  },
})
