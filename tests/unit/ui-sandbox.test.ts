import { describe, expect, it, vi } from 'vitest'

import uiSandbox from '../../dev/ui/module'

type Nuxt = Parameters<typeof uiSandbox>[1]

function configure(dev: boolean) {
  const hooks = new Map<string, (arg: unknown) => void>()
  const options = { dev, ssr: true, serverDir: '/real/server', nitro: { scheduledTasks: { hourly: ['cleanup'] } }, alias: {} }
  const nuxt = { options, hook: vi.fn((name: string, handler: (arg: unknown) => void) => hooks.set(name, handler)) } as unknown as Nuxt
  uiSandbox({}, nuxt)
  return { options, hooks, nuxt }
}

describe('UI sandbox isolation', () => {
  it('does nothing outside development, even when its module is explicitly loaded', () => {
    const { options, nuxt } = configure(false)
    expect(options).toMatchObject({ ssr: true, serverDir: '/real/server', nitro: { scheduledTasks: { hourly: ['cleanup'] } }, alias: {} })
    expect(nuxt.hook).not.toHaveBeenCalled()
  })

  it('selects fake providers and scans only the sandbox backend', () => {
    const { options, hooks } = configure(true)
    expect(options.ssr).toBe(false)
    expect(options.serverDir).toMatch(/\/dev\/ui\/server$/)
    expect(options.nitro.scheduledTasks).toEqual({})
    const nitro = { scanDirs: ['/real/server', options.serverDir] }
    hooks.get('nitro:config')!(nitro)
    expect(nitro.scanDirs).toEqual([options.serverDir])
    expect(options.alias).toMatchObject({
      '#voice-provider': expect.stringMatching(/\/dev\/ui\/voice.ts$/),
      '#socket-provider': expect.stringMatching(/\/dev\/ui\/socket.ts$/),
    })
    const app = {
      plugins: [],
      middleware: [
        { name: 'auth', path: '/real/auth' },
        { name: 'other', path: '/other' },
      ],
    }
    hooks.get('app:resolve')!(app)
    expect(app.middleware[0]!.path).toMatch(/\/dev\/ui\/auth.ts$/)
    expect(app.middleware[1]!.path).toBe('/other')
    expect(app.plugins).toHaveLength(2)
    const template = { filename: 'fetch.mjs', getContents: () => '' }
    hooks.get('app:templates')!({ templates: [template] })
    expect(template.getContents()).toContain('globalThis.fetch(...args)')
    expect(() => hooks.get('app:templates')!({ templates: [] })).toThrow('fetch boundary')
  })
})
