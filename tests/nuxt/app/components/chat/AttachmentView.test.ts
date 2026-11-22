import { UIcon } from '#components'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INLINE_IMAGE_MAX_BYTES } from '#shared/utils/files'
import AttachmentView from '~/components/chat/AttachmentView.vue'

const mocks = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    voice: {
      settings: ref({ speaker: { deviceId: 'voice', label: 'Voice' }, mediaSpeaker: { deviceId: 'media', label: 'Media' } }),
      devices: ref({
        speakers: [
          { deviceId: 'media', label: 'Media' },
          { deviceId: 'voice', label: 'Voice' },
        ],
      }),
    },
  }
})
mockNuxtImport('useVoice', () => () => mocks.voice)

afterEach(() => {
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId')
})

describe('attachment image opening', () => {
  it.each([false, true])('opens an image after revealing it when spoiler=%s', async spoiler => {
    const file = { id: 'image', filename: 'image.png', mime: 'image/png', size: 10, spoiler }
    const wrapper = await mountSuspended(AttachmentView, { props: { file } })
    const button = wrapper.find('button')
    if (spoiler) {
      expect(button.attributes('aria-label')).toBe('Spoiler: click to reveal')
      expect(wrapper.findComponent(UIcon).props('name')).toBe('i-lucide-eye')
      expect(wrapper.findComponent(UIcon).attributes('aria-hidden')).toBe('true')
      await button.trigger('click')
      expect(wrapper.emitted('open')).toBeUndefined()
    }
    expect(wrapper.findComponent(UIcon).exists()).toBe(false)
    expect(button.attributes('aria-label')).toBe('Open image.png')
    await button.trigger('click')
    expect(wrapper.emitted('open')).toEqual([[file]])
  })

  it('shows an image over the inline limit as a download card', async () => {
    const file = { id: 'big', filename: 'big.png', mime: 'image/png', size: INLINE_IMAGE_MAX_BYTES + 1, spoiler: false }
    const wrapper = await mountSuspended(AttachmentView, { props: { file } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('a').attributes('href')).toBe('/api/attachments/big?download=1')
  })
})

describe('attachment audio output', () => {
  it.each(['audio/ogg', 'video/mp4'])('routes %s playback to media output and follows changes', async mime => {
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    const setSinkId = vi.fn(async (_id: string) => {})
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: setSinkId })
    const wrapper = await mountSuspended(AttachmentView, { props: { file: { id: 'file', filename: 'file', mime, size: 10, spoiler: false } } })
    await flushPromises()
    const element = wrapper.find(mime.startsWith('audio/') ? 'audio' : 'video').element as HTMLMediaElement
    expect(setSinkId).toHaveBeenLastCalledWith('media')
    element.currentTime = 5
    element.volume = 0.3
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'voice', label: 'Voice' }
    await flushPromises()
    expect(setSinkId).toHaveBeenLastCalledWith('voice')
    expect(element.currentTime).toBe(5)
    expect(element.volume).toBe(0.3)
    wrapper.unmount()
    setSinkId.mockClear()
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    await flushPromises()
    expect(setSinkId).not.toHaveBeenCalled()
  })
})
