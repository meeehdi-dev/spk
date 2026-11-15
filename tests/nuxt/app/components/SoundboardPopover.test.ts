import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import SoundboardPopover from '~/components/SoundboardPopover.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    settings: ref({ soundboard: { on: true, volume: 0.7 } }),
    cooling: ref(false),
    press: vi.fn(),
  }
})
mockNuxtImport('useVoice', () => () => ({ channelId: { value: 'voice' }, settings: state.settings }))
mockNuxtImport('useSoundboard', () => () => ({ cooling: state.cooling, press: state.press }))
mockNuxtImport('useSounds', () => () => ({
  data: { value: [{ id: 'sound', name: 'Bell', icon: 'bell', durationMs: 1000 }] },
  refresh: vi.fn(),
}))

beforeEach(() => {
  state.settings.value.soundboard.on = true
  state.cooling.value = false
  state.press.mockClear()
})

it('disables sound buttons when hearing sounds is off and preserves cooldown disabling', async () => {
  const wrapper = await mountInApp(
    SoundboardPopover,
    {},
    {
      global: {
        stubs: {
          UPopover: { template: '<div><slot /><slot name="content" /></div>' },
        },
      },
    },
  )
  const sound = wrapper.get('button[aria-label="Play Bell"]')
  expect(sound.attributes('disabled')).toBeUndefined()
  await sound.trigger('click')
  expect(state.press).toHaveBeenCalledExactlyOnceWith('sound')

  await wrapper.get('button[role="switch"]').trigger('click')
  expect(state.settings.value.soundboard.on).toBe(false)
  expect(sound.attributes('disabled')).toBeDefined()
  await sound.trigger('click')
  expect(state.press).toHaveBeenCalledOnce()
  expect(wrapper.get('button[aria-label="Soundboard"]').attributes('disabled')).toBeUndefined()

  await wrapper.get('button[role="switch"]').trigger('click')
  expect(sound.attributes('disabled')).toBeUndefined()
  state.cooling.value = true
  await nextTick()
  expect(sound.attributes('disabled')).toBeDefined()
  state.cooling.value = false
  await nextTick()
  expect(sound.attributes('disabled')).toBeUndefined()
})
