import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import Notifications from '~/components/settings/Notifications.vue'

const push = vi.hoisted(() => ({ supported: true, subscribed: { value: false }, subscribe: vi.fn(), unsubscribe: vi.fn() }))
mockNuxtImport('usePush', () => () => push)
mockNuxtImport('useNotificationPermission', () => () => ({ permission: ref('granted'), ask: async () => {} }))

describe('push toggle', () => {
  it('shows the current state and lets push be enabled again after disabling', async () => {
    const subscribed = ref(false)
    Object.assign(push, {
      subscribed,
      subscribe: vi.fn(async () => {
        subscribed.value = true
      }),
      unsubscribe: vi.fn(async () => {
        subscribed.value = false
      }),
    })
    const wrapper = await mountSuspended(Notifications)
    const button = (label: string) => wrapper.findAll('button').find(b => b.text() === label)
    const expectState = (on: boolean) => {
      expect(wrapper.text()).toContain(on ? 'Push is on:' : 'Push is off:')
      expect(!!button('Turn push off')).toBe(on)
      expect(!!button('Enable notifications')).toBe(!on)
    }

    expectState(false)
    await button('Enable notifications')!.trigger('click')
    await nextTick()
    expectState(true)
    await button('Turn push off')!.trigger('click')
    await nextTick()
    expectState(false)
    await button('Enable notifications')!.trigger('click')
    await nextTick()
    expectState(true)
    expect(push.subscribe).toHaveBeenCalledTimes(2)
    expect(push.unsubscribe).toHaveBeenCalledOnce()
  })
})
