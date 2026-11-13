import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import setup from '~/plugins/pwa.client'

const { add, navigate } = vi.hoisted(() => ({ add: vi.fn(), navigate: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add }))
mockNuxtImport('navigateTo', () => navigate)

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setupClient(dev = false, workerSupported = true) {
  vi.stubEnv('DEV', dev)
  const hooks = new Map<string, (meta?: { id: string }) => void>()
  const register = vi.fn().mockResolvedValue({})
  const addEventListener = vi.fn()
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
  vi.stubGlobal('navigator', workerSupported ? { serviceWorker: { register, addEventListener } } : {})
  ;(setup as unknown as (app: { hook: (name: string, handler: (meta?: { id: string }) => void) => void }) => void)({
    hook: (name, handler) => hooks.set(name, handler),
  })
  return { hooks, register, addEventListener, reload }
}

describe('PWA client', () => {
  it('offers one dismissible notice per build and reloads only when Refresh is clicked', () => {
    const { hooks, reload } = setupClient()
    const update = hooks.get('app:manifest:update')!
    update()
    expect(add).not.toHaveBeenCalled()
    update({ id: 'build-2' })
    update({ id: 'build-2' })
    expect(add).toHaveBeenCalledExactlyOnceWith({
      id: 'app-update',
      title: 'Update available',
      description: 'Refreshing disconnects voice and loses unsent GIFs, attachments and replies. Draft text is saved.',
      duration: 0,
      actions: [{ label: 'Refresh', onClick: expect.any(Function) }],
    })
    expect(reload).not.toHaveBeenCalled()
    update({ id: 'build-3' })
    expect(add).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
    add.mock.calls[0]![0].actions[0].onClick()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('keeps the root worker registration and follows notification navigation messages', () => {
    const { register, addEventListener, reload } = setupClient()
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js')
    const [type, onMessage] = addEventListener.mock.calls[0]!
    expect(type).toBe('message')
    onMessage({ data: { type: 'other' } })
    expect(navigate).not.toHaveBeenCalled()
    onMessage({ data: { type: 'navigate', url: '/c/channel/m/message' } })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/c/channel/m/message')
    expect(reload).not.toHaveBeenCalled()
  })

  it('can offer app updates without service worker support', () => {
    const { hooks, register } = setupClient(false, false)
    hooks.get('app:manifest:update')!({ id: 'build-2' })
    expect(add).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()
  })

  it('does not register a worker or offer deployment updates during development', () => {
    const { hooks, register, addEventListener } = setupClient(true)
    expect(hooks.size).toBe(0)
    expect(register).not.toHaveBeenCalled()
    expect(addEventListener).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })
})
