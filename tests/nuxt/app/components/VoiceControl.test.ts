import { UButton } from '#components'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import VoiceControl from '~/components/VoiceControl.vue'
import { mountInApp } from '~~/tests/fixtures/app'

mockNuxtImport('useSocket', () => () => ({ connected: { value: true }, send: () => true, on: () => {}, onOpen: () => {} }))

afterEach(() => {
  const v = useVoice()
  v.channelId.value = null
  v.microphone.value = 'idle'
  v.screenDialog.value = false
  v.mute.value.muted = false
  v.mute.value.deafened = false
  v.camOn.value = false
  v.screenOn.value = false
})

describe('control styling', () => {
  it.each(['mic', 'deafen', 'camera', 'screen'] as const)('keeps the %s caret styled like its button when toggled', async kind => {
    const v = useVoice()
    v.channelId.value = 'channel'
    const wrapper = await mountInApp(VoiceControl, { kind })
    const buttons = wrapper.findAllComponents(UButton)
    expect(buttons).toHaveLength(2)

    for (const active of [true, false]) {
      v.mute.value.muted = active
      v.mute.value.deafened = active
      v.camOn.value = active
      v.screenOn.value = active
      await nextTick()

      const color = active ? (kind === 'mic' || kind === 'deafen' ? 'error' : 'primary') : 'neutral'
      for (const button of buttons) {
        expect(button.props('color')).toBe(color)
        expect(button.props('variant')).toBe(active ? 'soft' : 'ghost')
      }
    }
  })
})

describe('microphone control', () => {
  it('offers retry instead of a misleading mute action when the microphone is unavailable', async () => {
    const v = useVoice()
    v.channelId.value = 'channel'
    v.microphone.value = 'unavailable'
    const wrapper = await mountInApp(VoiceControl, { kind: 'mic' })
    const button = wrapper.get('button[aria-label="Enable microphone"]')
    await button.trigger('click')
    expect(v.mute.value.muted).toBe(false)
    expect(wrapper.findAllComponents(UButton)[0]!.props('icon')).toBe('i-lucide-mic-off')
  })
})

describe('screen control', () => {
  it('opens the screen dialog from the chevron without changing the saved quality', async () => {
    const v = useVoice()
    v.channelId.value = 'channel'
    const quality = v.settings.value.screenQuality
    const wrapper = await mountInApp(VoiceControl, { kind: 'screen' })
    expect(v.screenDialog.value).toBe(false)
    await wrapper.find('button[aria-label="Screen share options"]').trigger('click')
    expect(v.screenDialog.value).toBe(true)
    expect(v.settings.value.screenQuality).toEqual(quality)
  })
})
