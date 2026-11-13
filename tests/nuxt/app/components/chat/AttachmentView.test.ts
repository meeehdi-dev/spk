import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
