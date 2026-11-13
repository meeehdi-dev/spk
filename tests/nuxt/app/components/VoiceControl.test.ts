import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'

import VoiceControl from '~/components/VoiceControl.vue'
import { mountInApp } from '~~/tests/fixtures/app'

mockNuxtImport('useSocket', () => () => ({ connected: { value: true }, send: () => true, on: () => {}, onOpen: () => {} }))

afterEach(() => {
  const v = useVoice()
  v.channelId.value = null
  v.screenDialog.value = false
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
