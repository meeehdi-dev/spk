import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Soundboard from '~/components/settings/Soundboard.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const mocks = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    voice: {
      settings: ref({ mediaSpeaker: { deviceId: 'media', label: 'Media' } }),
      devices: ref({
        speakers: [
          { deviceId: 'media', label: 'Media' },
          { deviceId: 'other', label: 'Other' },
        ],
      }),
    },
    sounds: ref([]),
    element: undefined as HTMLAudioElement | undefined,
    destroy: vi.fn(),
  }
})
mockNuxtImport('useVoice', () => () => mocks.voice)
mockNuxtImport('useSounds', () => () => ({ data: mocks.sounds, refresh: async () => {} }))
vi.mock('wavesurfer.js', () => ({ default: { create: () => ({ getMediaElement: () => mocks.element, on: () => {}, destroy: mocks.destroy }) } }))
vi.mock('wavesurfer.js/plugins/regions', () => ({ default: { create: () => ({ on: () => {} }) } }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('soundboard upload preview output', () => {
  it('routes a new editor and live output changes, then releases it on discard', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sound')
    mocks.element = document.createElement('audio')
    const setSinkId = vi.fn(async (_id: string) => {})
    Object.defineProperty(mocks.element, 'setSinkId', { value: setSinkId })
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = async () => ({ duration: 1 })
        close = async () => {}
      },
    )
    const wrapper = await mountInApp(Soundboard)
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'sound.wav', { type: 'audio/wav' })] })
    await input.trigger('change')
    await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledWith('media'))
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'other', label: 'Other' }
    await flushPromises()
    expect(setSinkId).toHaveBeenLastCalledWith('other')
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Discard')!
      .trigger('click')
    expect(mocks.destroy).toHaveBeenCalledOnce()
    setSinkId.mockClear()
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    await flushPromises()
    expect(setSinkId).not.toHaveBeenCalled()
  })
})
