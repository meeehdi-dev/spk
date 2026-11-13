import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'

import { usePush, usePushSync } from '~/composables/usePush'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  localStorage.clear()
})

describe('usePushSync', () => {
  it('re-sends prefs to the server when the status becomes busy, without Settings mounted', async () => {
    vi.stubEnv('DEV', false)
    const put = vi.fn()
    registerEndpoint('/api/push', { method: 'PUT', handler: async event => put(await readBody(event)) ?? {} })
    vi.stubGlobal('PushManager', {})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ endpoint: 'e' }) } }) },
    })
    await mountSuspended(defineComponent({ setup: () => (usePushSync(), () => null) }))
    vi.useFakeTimers()
    useMyStatus().value = 'busy'
    await nextTick()
    await vi.advanceTimersByTimeAsync(600)
    vi.useRealTimers()
    await vi.waitFor(() => expect(put).toHaveBeenCalledWith({ endpoint: 'e', prefs: expect.objectContaining({ dnd: true }) }))
  })
})

describe('usePush during development', () => {
  it('disables subscriptions without waiting for a worker, even with VAPID configured', async () => {
    vi.stubEnv('DEV', true)
    const ready = vi.fn()
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
    vi.stubGlobal('$fetch', fetch)
    useRuntimeConfig().public.vapidPublicKey = 'configured'
    let push!: ReturnType<typeof usePush>
    await mountSuspended(defineComponent({ setup: () => ((push = usePush()), () => null) }))
    expect(push.supported).toBe(false)
    await push.subscribe()
    await push.unsubscribe()
    expect(push.subscribed.value).toBe(false)
    expect(ready).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
