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
    sounds: ref([{ id: 'sound', name: 'Bell', icon: 'bell', durationMs: 1000 }]),
    refresh: vi.fn(),
  }
})
mockNuxtImport('useVoice', () => () => ({ channelId: { value: 'voice' }, settings: state.settings }))
mockNuxtImport('useSoundboard', () => () => ({ cooling: state.cooling, press: state.press }))
mockNuxtImport('useSounds', () => () => ({
  data: state.sounds,
  refresh: state.refresh,
}))

beforeEach(() => {
  state.settings.value.soundboard.on = true
  state.cooling.value = false
  state.press.mockClear()
  state.refresh.mockClear()
  state.sounds.value = [{ id: 'sound', name: 'Bell', icon: 'bell', durationMs: 1000 }]
})

const mountPopover = () =>
  mountInApp(
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

it('caps the listening slider at unity', async () => {
  const wrapper = await mountPopover()
  const slider = wrapper.findComponent({ name: 'USlider' })
  expect(slider.props()).toMatchObject({ min: 0, max: 1, step: 0.01 })
  slider.vm.$emit('update:modelValue', 0.4)
  await nextTick()
  expect(state.settings.value.soundboard.volume).toBe(0.4)
})

it('disables sound buttons when hearing sounds is off and preserves cooldown disabling', async () => {
  const wrapper = await mountPopover()
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

it('keeps search, results and controls mounted across refresh sizes and empty searches', async () => {
  const wrapper = await mountPopover()
  const search = wrapper.get('input[aria-label="Search sounds"]')
  const results = wrapper.get('[aria-label="Sounds"]')
  const toggle = wrapper.get('button[role="switch"]').element
  const slider = wrapper.get('[role="slider"]').element
  expect(results.classes()).toContain('h-60')
  expect(results.find('[aria-label="Play Bell"]').exists()).toBe(true)

  state.sounds.value = Array.from({ length: 9 }, (_, i) => ({ id: `sound-${i}`, name: `Sound ${i}`, icon: 'bell', durationMs: 1000 }))
  await nextTick()
  expect(wrapper.get('input[aria-label="Search sounds"]').element).toBe(search.element)
  expect(results.findAll('button').length).toBe(9)
  await search.setValue('missing')
  expect(results.text()).toBe('No match.')

  state.sounds.value = []
  await nextTick()
  expect(results.text()).toContain('No sounds yet.')
  expect(wrapper.get('input[aria-label="Search sounds"]').element).toBe(search.element)
  expect(wrapper.get('button[role="switch"]').element).toBe(toggle)
  expect(wrapper.get('[role="slider"]').element).toBe(slider)
  expect(results.classes()).toContain('h-60')

  state.sounds.value = [{ id: 'sound', name: 'Bell', icon: 'bell', durationMs: 1000 }]
  await search.setValue('bell')
  expect(results.find('[aria-label="Play Bell"]').exists()).toBe(true)
})
