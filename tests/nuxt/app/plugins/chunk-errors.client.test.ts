import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import setup from '~/plugins/chunk-errors.client'

const { add, navigate } = vi.hoisted(() => ({ add: vi.fn(), navigate: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add }))
mockNuxtImport('navigateTo', () => navigate)

afterEach(() => vi.restoreAllMocks())

describe('manual chunk error handling', () => {
  it('only notifies on chunk errors, without navigating or reloading on errors or updates', () => {
    const hooks = new Map<string, (...args: unknown[]) => void>()
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const href = window.location.href
    ;(setup as unknown as (app: { hook: (name: string, handler: (...args: unknown[]) => void) => void }) => void)({
      hook: (name, handler) => hooks.set(name, handler),
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
