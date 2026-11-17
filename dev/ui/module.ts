import type { Nuxt } from 'nuxt/schema'

import { fileURLToPath } from 'node:url'

const localPath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Explicit opt-in and a dev-only gate: production always uses the real providers. */
export default function uiSandbox(_options: unknown, nuxt: Nuxt) {
  if (!nuxt.options.dev) return
  nuxt.options.ssr = false
  nuxt.options.serverDir = localPath('./server')
  nuxt.options.nitro.scheduledTasks = {}
  nuxt.hook('nitro:config', config => {
    // Nitro merges layer scan directories after module setup; replace the final list, not the input.
    config.scanDirs = [localPath('./server')]
  })
  nuxt.options.alias['#voice-provider'] = localPath('./voice.ts')
  nuxt.options.alias['#socket-provider'] = localPath('./socket.ts')
  nuxt.options.alias['~/utils/auth-client'] = localPath('./auth.ts')
  nuxt.hook('imports:extend', imports => {
    for (const item of imports) {
      if (/\/utils\/auth-client(\.ts)?$/.test(item.from)) item.from = localPath('./auth.ts')
    }
  })
  nuxt.hook('app:resolve', app => {
    app.plugins.push({ src: localPath('./plugin.ts'), mode: 'client' }, { src: localPath('./panel-plugin.ts'), mode: 'client' })
    for (const middleware of app.middleware) {
      if (middleware.name === 'auth') middleware.path = localPath('./auth.ts')
    }
  })
  nuxt.hook('app:templates', app => {
    const template = app.templates.find(t => t.filename === 'fetch.mjs')
    if (!template) throw new Error('UI sandbox could not configure the Nuxt fetch boundary')
    // useFetch captures this instance before plugins; defer native fetch lookup until each request.
    template.getContents = () => `import { createFetch } from 'ofetch'
import { baseURL } from '#internal/nuxt/paths'
globalThis.$fetch = createFetch({ fetch: (...args) => globalThis.fetch(...args), defaults: { baseURL: baseURL(), retry: 0 } })
export const $fetch = globalThis.$fetch
`
  })
}
