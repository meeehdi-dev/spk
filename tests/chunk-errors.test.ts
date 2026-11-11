// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('manual chunk error handling', () => {
  it('enables Nuxt manual handling without disabling the manifest', async () => {
    vi.stubGlobal('defineNuxtConfig', (config: unknown) => config)
    const { default: config } = await import('../nuxt.config')
    expect(config.experimental?.emitRouteChunkError).toBe('manual')
    expect(config.experimental).not.toHaveProperty('appManifest', false)
  })

  it('only notifies on chunk errors, without navigating or reloading on errors or updates', async () => {
    const hooks = new Map<string, (...args: unknown[]) => void>()
    const add = vi.fn()
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const navigate = vi.fn()
    const href = window.location.href
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('reloadNuxtApp', reload)
    vi.stubGlobal('useToast', () => ({ add }))
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)
    const { default: setup } = await import('../app/plugins/chunk-errors.client')
    ;(setup as (app: { hook: (name: string, handler: (...args: unknown[]) => void) => void }) => void)({
      hook: (name: string, handler: (...args: unknown[]) => void) => hooks.set(name, handler),
    })

    expect([...hooks.keys()]).toEqual(['app:chunkError'])
    hooks.get('app:manifest:update')?.({ id: 'new-build' })
    expect(add).not.toHaveBeenCalled()
    hooks.get('app:chunkError')!({ error: new Error('Missing route chunk') })
    expect(add).toHaveBeenCalledExactlyOnceWith({
      id: 'chunk-error',
      title: 'Could not load this page',
      description: 'Refresh manually to try again. Unsent GIFs, attachments and replies will be lost; draft text is saved.',
      color: 'error',
    })
    expect(reload).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(window.location.href).toBe(href)
  })
})
