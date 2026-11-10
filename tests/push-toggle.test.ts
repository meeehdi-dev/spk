// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { parse } from 'vue/compiler-sfc'

const { descriptor } = parse(readFileSync('app/components/settings/Notifications.vue', 'utf8'))

describe('push toggle', () => {
  it('shows the current state and lets push be enabled again after disabling', async () => {
    const push = { supported: true, subscribed: ref(false) }
    const enable = vi.fn(() => { push.subscribed.value = true })
    const disablePush = vi.fn(() => { push.subscribed.value = false })
    const slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
    const button = defineComponent({
      props: ['label'],
      setup: (props) => () => h('button', props.label)
    })
    const app = createApp({
      template: descriptor.template!.content,
      components: { UCard: slot, UFormField: slot, UButton: button, USwitch: slot, USlider: slot },
      setup: () => ({
        push, enable, disablePush, permission: ref('granted'), busy: ref(false),
        s: ref({ dms: true, pings: true, dnd: false, sound: true, volume: 0.5 }),
        playBlip: vi.fn()
      })
    })
    const container = document.createElement('div')
    app.mount(container)

    const findButton = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)
    const expectState = (on: boolean) => {
      expect(container.textContent).toContain(on ? 'Push is on:' : 'Push is off:')
      expect(!!findButton('Turn push off')).toBe(on)
      expect(!!findButton('Enable notifications')).toBe(!on)
    }

    try {
      expectState(false)
      findButton('Enable notifications')!.click()
      await nextTick()
      expectState(true)
      findButton('Turn push off')!.click()
      await nextTick()
      expectState(false)
      findButton('Enable notifications')!.click()
      await nextTick()
      expectState(true)
      expect(enable).toHaveBeenCalledTimes(2)
      expect(disablePush).toHaveBeenCalledOnce()
    } finally {
      app.unmount()
    }
  })
})
