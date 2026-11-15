import { UButton } from '#components'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, expect, it, vi } from 'vitest'

import RadioIndicator from '~/components/RadioIndicator.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    channelId: ref<string | null>('voice'),
    station: ref({ id: 'station', name: 'Jazz' }),
    enabled: ref(true),
    playback: ref('playing'),
    listen: vi.fn(),
    mute: vi.fn(),
  }
})
mockNuxtImport('useVoice', () => () => ({ channelId: state.channelId }))
mockNuxtImport('useRadio', () => () => state)

beforeEach(() => {
  vi.clearAllMocks()
  state.channelId.value = 'voice'
  state.enabled.value = true
  state.playback.value = 'playing'
  state.listen.mockImplementation(() => {
    state.enabled.value = true
  })
  state.mute.mockImplementation(() => {
    state.enabled.value = false
  })
})

it('pauses and resumes local playback with a neutral paused icon and standard button sizing', async () => {
  const wrapper = await mountInApp(RadioIndicator, { channelId: 'voice', station: state.station.value })
  expect(wrapper.findComponent(UButton).props()).toMatchObject({ color: 'primary', variant: 'ghost', icon: 'i-lucide-radio' })
  await wrapper.get('button[aria-label="Pause radio: Jazz"]').trigger('click')
  expect(state.mute).toHaveBeenCalledOnce()
  expect(wrapper.findComponent(UButton).props('color')).toBe('neutral')
  expect(wrapper.get('button').attributes('aria-pressed')).toBe('false')
  await wrapper.get('button[aria-label="Resume radio: Jazz"]').trigger('click')
  expect(state.listen).toHaveBeenCalledOnce()
  expect(wrapper.get('button').attributes('aria-pressed')).toBe('true')
})

it.each(['blocked', 'error'])('resumes %s playback', async playback => {
  state.playback.value = playback
  const wrapper = await mountInApp(RadioIndicator, { channelId: 'voice', station: state.station.value })
  await wrapper.get('button[aria-label="Resume radio: Jazz"]').trigger('click')
  expect(state.listen).toHaveBeenCalledOnce()
  expect(state.mute).not.toHaveBeenCalled()
})

it('keeps other channels informational and hides channels without a station', async () => {
  const wrapper = await mountInApp(RadioIndicator, { channelId: 'other', station: state.station.value })
  expect(wrapper.find('button').exists()).toBe(false)
  expect(wrapper.findComponent(UButton).props('as')).toBe('span')
  expect(wrapper.get('[aria-label="Radio selected: Jazz"]').find('[data-slot="leadingIcon"]').exists()).toBe(true)
  expect(state.listen).not.toHaveBeenCalled()
  expect(state.mute).not.toHaveBeenCalled()
  const empty = await mountInApp(RadioIndicator, { channelId: 'other', station: undefined })
  expect(empty.findComponent(UButton).exists()).toBe(false)
})
