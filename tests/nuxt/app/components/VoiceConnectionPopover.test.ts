import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'

import VoiceConnectionPopover from '~/components/VoiceConnectionPopover.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const voice = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    connectionLabel: ref('Connected'),
    ping: ref<number | null>(42),
    pingHistory: ref([{ time: Date.now(), ping: 42 }]),
    diagnostics: ref(null),
    audioBlocked: ref(false),
    microphone: ref('ready'),
  }
})
mockNuxtImport('useVoice', () => () => voice)

it('keeps ping out of the trigger and opens live diagnostics for any status', async () => {
  const wrapper = await mountInApp(VoiceConnectionPopover)
  const trigger = wrapper.find('button')
  expect(trigger.text()).toBe('Connected')
  expect(trigger.text()).not.toContain('ms')
  await trigger.trigger('click')
  await flushPromises()
  const panel = () => document.querySelector('section[aria-label="Voice connection diagnostics"]')!
  await vi.waitFor(() => expect(panel()).not.toBeNull())
  expect(panel().textContent).toContain('42 ms')
  expect(panel().textContent).toContain('Unavailable')
  expect(panel().querySelector('svg')?.getAttribute('aria-label')).toContain('42 to 42')
  voice.connectionLabel.value = 'Voice reconnecting…'
  voice.ping.value = null
  voice.audioBlocked.value = true
  await flushPromises()
  expect(trigger.text()).toBe('Voice reconnecting…')
  expect(panel().textContent).toContain('Audio playback is blocked')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await vi.waitFor(() => expect(trigger.attributes('aria-expanded')).toBe('false'))
  await trigger.trigger('click')
  await vi.waitFor(() => expect(trigger.attributes('aria-expanded')).toBe('true'))
})
