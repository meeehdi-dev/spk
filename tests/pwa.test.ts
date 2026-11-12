// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function setupClient(dev = false, workerSupported = true) {
  vi.stubEnv('DEV', dev)
  const hooks = new Map<string, (meta?: { id: string }) => void>()
  const add = vi.fn()
  const register = vi.fn().mockResolvedValue({})
  const addEventListener = vi.fn()
  const navigate = vi.fn()
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
  vi.stubGlobal('navigator', workerSupported ? { serviceWorker: { register, addEventListener } } : {})
  vi.stubGlobal('navigateTo', navigate)
  vi.stubGlobal('useToast', () => ({ add }))
  vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)
  const { default: setup } = await import('../app/plugins/pwa.client')
  ;(setup as (app: { hook: (name: string, handler: (meta?: { id: string }) => void) => void }) => void)({
    hook: (name, handler) => hooks.set(name, handler),
  })
  return { hooks, add, register, addEventListener, navigate, reload }
}

describe('PWA client', () => {
  it('offers one dismissible notice per build and reloads only when Refresh is clicked', async () => {
    const { hooks, add, reload } = await setupClient()
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

  it('keeps the root worker registration and follows notification navigation messages', async () => {
    const { register, addEventListener, navigate, reload } = await setupClient()
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js')
    const [type, onMessage] = addEventListener.mock.calls[0]!
    expect(type).toBe('message')
    onMessage({ data: { type: 'other' } })
    expect(navigate).not.toHaveBeenCalled()
    onMessage({ data: { type: 'navigate', url: '/c/channel/m/message' } })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/c/channel/m/message')
    expect(reload).not.toHaveBeenCalled()
  })

  it('can offer app updates without service worker support', async () => {
    const { hooks, register, add } = await setupClient(false, false)
    hooks.get('app:manifest:update')!({ id: 'build-2' })
    expect(add).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()
  })

  it('does not register a worker or offer deployment updates during development', async () => {
    const { hooks, register, addEventListener, add } = await setupClient(true)
    expect(hooks.size).toBe(0)
    expect(register).not.toHaveBeenCalled()
    expect(addEventListener).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })
})

describe('development push', () => {
  it('disables subscriptions without waiting for a worker, even with VAPID configured', async () => {
    vi.stubEnv('DEV', true)
    const ready = vi.fn()
    const mounted: (() => Promise<void>)[] = []
    const fetch = vi.fn()
    vi.stubGlobal('navigator', {
      serviceWorker: {
        get ready() {
          ready()
          throw new Error('There is no development worker')
        },
      },
    })
    vi.stubGlobal('PushManager', {})
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('onMounted', (callback: () => Promise<void>) => mounted.push(callback))
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { vapidPublicKey: 'configured' } }))
    vi.stubGlobal('$fetch', fetch)
    const { usePush } = await import('../app/composables/usePush')
    const push = usePush()
    expect(push.supported).toBe(false)
    await mounted[0]!()
    await push.subscribe()
    await push.unsubscribe()
    expect(push.subscribed.value).toBe(false)
    expect(ready).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
