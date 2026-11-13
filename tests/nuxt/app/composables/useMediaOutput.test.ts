import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'

import { useMediaAudioLive, useMediaOutput } from '~/composables/useMediaOutput'

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
    setOutput: vi.fn(),
    close: vi.fn(),
  }
})
mockNuxtImport('useVoice', () => () => mocks.voice)
vi.mock('~/utils/media-audio', () => ({ setMediaAudioOutput: mocks.setOutput, closeMediaAudio: mocks.close }))

let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
  mocks.voice.devices.value.speakers = [
    { deviceId: 'media', label: 'Media' },
    { deviceId: 'voice', label: 'Voice' },
  ]
  scope = effectScope()
})
afterEach(() => scope.stop())

describe('media output following', () => {
  it('routes new and replacement media elements and follows live device changes', async () => {
    const element = shallowRef<HTMLMediaElement>()
    scope.run(() => useMediaOutput(element))
    const first = document.createElement('audio')
    const setSinkId = vi.fn(async (_id: string) => {})
    Object.defineProperty(first, 'setSinkId', { value: setSinkId })
    element.value = first
    await flushPromises()
    expect(setSinkId).toHaveBeenLastCalledWith('media')
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'voice', label: 'Voice' }
    await flushPromises()
    expect(setSinkId).toHaveBeenLastCalledWith('voice')
    const replacement = document.createElement('video')
    const nextSink = vi.fn(async (_id: string) => {})
    Object.defineProperty(replacement, 'setSinkId', { value: nextSink })
    element.value = replacement
    await flushPromises()
    expect(nextSink).toHaveBeenLastCalledWith('voice')
    setSinkId.mockClear()
    scope.stop()
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    await flushPromises()
    expect(nextSink).toHaveBeenCalledOnce()
    expect(setSinkId).not.toHaveBeenCalled()
  })

  it('falls back and restores by label on device changes without needing a voice call', async () => {
    const setSinkId = vi.fn(async (_id: string) => {})
    const element = ref({ setSinkId } as unknown as HTMLMediaElement)
    scope.run(() => useMediaOutput(element))
    await flushPromises()
    mocks.voice.devices.value.speakers = []
    await flushPromises()
    expect(setSinkId).toHaveBeenLastCalledWith('')
    mocks.voice.devices.value.speakers = [{ deviceId: 'new', label: 'Media' }]
    await flushPromises()
    expect(setSinkId).toHaveBeenLastCalledWith('new')
    expect(mocks.voice.settings.value.mediaSpeaker.deviceId).toBe('media')
  })

  it('keeps the shared audio sink live for the layout lifetime and closes it on disposal', () => {
    scope.run(() => useMediaAudioLive())
    expect(mocks.setOutput).toHaveBeenLastCalledWith('media', undefined, expect.any(Function))
    mocks.voice.devices.value.speakers = []
    expect(mocks.setOutput).toHaveBeenLastCalledWith('', 'media', expect.any(Function))
    scope.stop()
    expect(mocks.close).toHaveBeenCalledOnce()
    mocks.voice.devices.value.speakers = [{ deviceId: 'media', label: 'Media' }]
    expect(mocks.setOutput).toHaveBeenCalledTimes(2)
  })
})
