import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '#shared': new URL('./shared', import.meta.url).pathname, '~': new URL('./app', import.meta.url).pathname } },
  define: { 'import.meta.client': 'true' },
  test: { include: ['tests/**/*.test.ts'] },
})
