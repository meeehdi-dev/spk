import { resolve } from 'node:path'

import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

const root = (path: string) => resolve(import.meta.dirname, path)
const alias = { '~~': root('.'), '~': root('./app'), '#shared': root('./shared') }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        define: { 'import.meta.client': 'true' },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      await defineVitestProject({
        // The first mount in a file compiles its whole component tree, which can exceed 5 s under a parallel run.
        test: { name: 'nuxt', include: ['tests/nuxt/**/*.test.ts'], environment: 'nuxt', setupFiles: ['tests/setup/nuxt.ts'], testTimeout: 15_000 },
      }),
    ],
  },
})
