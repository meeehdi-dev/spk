import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    source: { connect: vi.fn(), disconnect: vi.fn() },
    gain: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    clipper: { curve: null as Float32Array | null, connect: vi.fn(), disconnect: vi.fn() },
    destination: {},
    play: vi.fn(),
    playMediaAudio: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
  }
})
mockNuxtImport('useVoice', () => () => mocks.voice)
mockNuxtImport('useSounds', () => () => ({ data: mocks.sounds, refresh: async () => {} }))
vi.mock('~/utils/media-audio', () => ({
  getMediaAudio: () => ({
    context: {
      createMediaElementSource: () => mocks.source,
      createGain: () => mocks.gain,
      createWaveShaper: () => mocks.clipper,
    },
    destination: mocks.destination,
    element: mocks.element,
  }),
  playMediaAudio: mocks.playMediaAudio,
}))
vi.mock('wavesurfer.js', () => ({ default: { create: mocks.create } }))
vi.mock('wavesurfer.js/plugins/regions', () => ({
  default: { create: () => ({ on: () => {}, addRegion: () => ({ start: 0, end: 1, play: mocks.play }) }) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.gain.gain.value = 1
  mocks.source.connect.mockReturnValue(mocks.gain)
  mocks.gain.connect.mockReturnValue(mocks.clipper)
  mocks.playMediaAudio.mockImplementation(async (play: () => void) => play())
  registerEndpoint('/api/sounds/presign', {
    method: 'POST',
    handler: () => ({ id: 'sound', url: 'https://upload.test/sound', headers: {} }),
  })
  registerEndpoint('/api/sounds', { method: 'POST', handler: async event => (mocks.save(await readBody(event)), {}) })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sound')
  mocks.element = document.createElement('audio')
  mocks.create.mockImplementation(() => ({
    getMediaElement: () => mocks.element,
    on: (event: string, callback: (duration: number) => void) => {
      if (event === 'decode') callback(1)
    },
    destroy: mocks.destroy,
  }))
  vi.stubGlobal(
    'AudioContext',
    class {
      decodeAudioData = async () => ({
        duration: 1,
        numberOfChannels: 1,
        sampleRate: 4,
        getChannelData: () => new Float32Array([0.25, -0.25, 0.75, -0.75]),
      })
      close = async () => {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('soundboard upload preview output', () => {
  it('previews gain, warns about clipping, uploads transformed audio and resets the slider', async () => {
    const upload = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', upload)
    const wrapper = await mountInApp(Soundboard)
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'sound.wav', { type: 'audio/wav' })] })
    await input.trigger('change')
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled())
    expect(mocks.source.connect).toHaveBeenCalledWith(mocks.gain)
    expect(mocks.gain.connect).toHaveBeenCalledWith(mocks.clipper)
    expect(mocks.clipper.connect).toHaveBeenCalledWith(mocks.destination)
    expect(Array.from(mocks.clipper.curve!)).toEqual([-1, 0, 1])
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Play selection')!
      .trigger('click')
    expect(mocks.playMediaAudio).toHaveBeenCalledOnce()
    expect(mocks.play).toHaveBeenCalledWith(true)
    const slider = wrapper.findComponent({ name: 'USlider' })
    expect(slider.props('modelValue')).toBe(100)
    slider.vm.$emit('update:modelValue', 50)
    await flushPromises()
    expect(mocks.gain.gain.value).toBe(0.5)
    expect(wrapper.text()).not.toContain('This volume clips peaks')
    slider.vm.$emit('update:modelValue', 200)
    await flushPromises()
    expect(mocks.gain.gain.value).toBe(2)
    expect(wrapper.text()).toContain('This volume clips peaks')
    const save = wrapper.findAll('button').find(button => button.text() === 'Save')!
    await vi.waitFor(() => expect(save.attributes('disabled')).toBeUndefined())
    await save.trigger('click')
    await vi.waitFor(() => expect(upload).toHaveBeenCalled())
    const wav = upload.mock.calls[0]![1].body as Uint8Array
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(Array.from({ length: 4 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([16384, -16384, 32767, -32768])
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ id: 'sound', name: 'sound', icon: 'audio-lines', durationMs: 1000, size: 52 }))
    await vi.waitFor(() => expect(slider.props('modelValue')).toBe(100))
  })

  it('routes a new editor and live output changes, then releases it on discard', async () => {
    const setSinkId = vi.fn(async (_id: string) => {})
    Object.defineProperty(mocks.element, 'setSinkId', { value: setSinkId })
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
    expect(mocks.source.disconnect).toHaveBeenCalledOnce()
    expect(mocks.gain.disconnect).toHaveBeenCalledOnce()
    expect(mocks.clipper.disconnect).toHaveBeenCalledOnce()
    setSinkId.mockClear()
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    await flushPromises()
    expect(setSinkId).not.toHaveBeenCalled()
  })
})
