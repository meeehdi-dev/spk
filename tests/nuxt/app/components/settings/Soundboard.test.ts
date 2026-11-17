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
    settings: ref({ soundboard: { on: true, volume: 0.7 } }),
    sounds: ref([]),
    players: [] as HTMLAudioElement[],
    play: vi.fn(),
    pause: vi.fn(),
    load: vi.fn(),
    setSinkId: vi.fn(),
    frames: new Map<number, FrameRequestCallback>(),
    nextFrame: 0,
    setTime: vi.fn(),
    destroy: vi.fn(),
    decoded: {
      duration: 1,
      numberOfChannels: 2,
      sampleRate: 4,
      getChannelData: (i: number) => new Float32Array(i ? [-0.25, 0.25, -0.75, 0.75] : [0.25, -0.25, 0.75, -0.75]),
    },
    regionUpdated: undefined as ((region: { start: number; end: number }) => void) | undefined,
    create: vi.fn(),
    save: vi.fn(),
    close: vi.fn(),
    toast: vi.fn(),
  }
})
mockNuxtImport('useToast', () => () => ({ add: mocks.toast }))
mockNuxtImport('useVoice', () => () => mocks.voice)
mockNuxtImport('useVoiceSettings', () => () => mocks.settings)
mockNuxtImport('useSounds', () => () => ({ data: mocks.sounds, refresh: async () => {} }))
vi.mock('wavesurfer.js', () => ({ default: { create: mocks.create } }))
vi.mock('wavesurfer.js/plugins/regions', () => ({
  default: {
    create: () => ({
      on: (_event: string, callback: typeof mocks.regionUpdated) => {
        mocks.regionUpdated = callback
      },
      addRegion: () => ({ start: 0, end: 1 }),
    }),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.value.soundboard.volume = 0.7
  mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
  mocks.decoded.numberOfChannels = 2
  mocks.players = []
  mocks.frames.clear()
  mocks.nextFrame = 0
  mocks.play.mockResolvedValue(undefined)
  mocks.setSinkId.mockResolvedValue(undefined)
  registerEndpoint('/api/sounds/presign', {
    method: 'POST',
    handler: () => ({ id: 'sound', url: 'https://upload.test/sound', headers: {} }),
  })
  registerEndpoint('/api/sounds', { method: 'POST', handler: async event => (mocks.save(await readBody(event)), {}) })
  mocks.create.mockImplementation(() => ({
    on: (event: string, callback: (duration: number) => void) => {
      if (event === 'decode') callback(1)
    },
    setTime: mocks.setTime,
    destroy: mocks.destroy,
  }))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sound')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('Audio', function Audio(url: string) {
    const player = document.createElement('audio')
    player.src = url
    Object.defineProperties(player, {
      play: { value: mocks.play },
      pause: { value: mocks.pause },
      load: { value: mocks.load },
      setSinkId: { value: mocks.setSinkId },
    })
    mocks.players.push(player)
    return player
  })
  vi.stubGlobal(
    'AudioContext',
    class {
      decodeAudioData = async () => mocks.decoded
      close = mocks.close
    },
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++mocks.nextFrame
      mocks.frames.set(id, callback)
      return id
    }),
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => mocks.frames.delete(id)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function loadSound() {
  const wrapper = await mountInApp(Soundboard)
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'sound.wav', { type: 'audio/wav' })] })
  await input.trigger('change')
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled())
  return wrapper
}

async function startPreview(wrapper: Awaited<ReturnType<typeof loadSound>>) {
  await wrapper
    .findAll('button')
    .find(button => button.text() === 'Play selection')!
    .trigger('click')
  await vi.waitFor(() => expect(wrapper.findAll('button').some(button => button.text() === 'Pause')).toBe(true))
  return mocks.players.at(-1)!
}

function tick() {
  const [id, callback] = [...mocks.frames.entries()][0]!
  mocks.frames.delete(id)
  callback(performance.now())
}

describe('soundboard upload preview output', () => {
  it('previews the actual stereo upload bytes directly at listener volume and saves without a lossy encode', async () => {
    const upload = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', upload)
    const wrapper = await loadSound()
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({
      peaks: [mocks.decoded.getChannelData(0), mocks.decoded.getChannelData(1)],
      duration: 1,
      interact: false,
    })
    const slider = wrapper.findComponent({ name: 'USlider' })
    expect(slider.props('modelValue')).toBe(100)
    slider.vm.$emit('update:modelValue', 50)
    await flushPromises()
    const player = await startPreview(wrapper)
    expect(player.src).toBe('blob:sound')
    expect(player.srcObject).toBeNull()
    expect(player.loop).toBe(true)
    expect(player.volume).toBe(0.7)
    mocks.settings.value.soundboard.volume = 0.4
    await flushPromises()
    expect(player.volume).toBe(0.4)
    expect(wrapper.text()).toContain('listening volume (40%)')
    const previewBlob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob
    expect(previewBlob.type).toBe('audio/wav')
    const previewBytes = new Uint8Array(await previewBlob.arrayBuffer())
    const save = wrapper.findAll('button').find(button => button.text() === 'Save')!
    await vi.waitFor(() => expect(save.attributes('disabled')).toBeUndefined())
    await save.trigger('click')
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    const wav = upload.mock.calls[0]![1].body as Uint8Array
    expect(wav).toEqual(previewBytes)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(24)
    const pcm = Array.from(
      { length: 8 },
      (_, i) => ((view.getUint8(44 + i * 3) | (view.getUint8(45 + i * 3) << 8) | (view.getUint8(46 + i * 3) << 16)) << 8) >> 8,
    )
    expect(pcm).toEqual([1048576, -1048576, -1048576, 1048576, 3145728, -3145728, -3145728, 3145728])
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ id: 'sound', name: 'sound', icon: 'audio-lines', durationMs: 1000, size: 68 }))
    await vi.waitFor(() => expect(slider.props('modelValue')).toBe(100))
    expect(mocks.pause).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sound')
  })

  it('blocks clipping before preview or upload and stops stale preview when gain or selection changes', async () => {
    const wrapper = await loadSound()
    await startPreview(wrapper)
    const slider = wrapper.findComponent({ name: 'USlider' })
    slider.vm.$emit('update:modelValue', 200)
    await flushPromises()
    expect(mocks.pause).toHaveBeenCalledOnce()
    expect(wrapper.find('[role="status"]').text()).toContain('Lower it before previewing or saving')
    const play = wrapper.findAll('button').find(button => button.text() === 'Play selection')!
    expect(play.attributes('disabled')).toBeDefined()
    expect(
      wrapper
        .findAll('button')
        .find(button => button.text() === 'Save')!
        .attributes('disabled'),
    ).toBeDefined()
    await play.trigger('click')
    expect(mocks.play).toHaveBeenCalledOnce()
    slider.vm.$emit('update:modelValue', 100)
    await flushPromises()
    await startPreview(wrapper)
    mocks.regionUpdated!({ start: 0.25, end: 0.75 })
    await flushPromises()
    expect(mocks.pause).toHaveBeenCalledTimes(2)
    expect(mocks.frames.size).toBe(0)
  })

  it('routes live output changes and releases playback and animation on discard', async () => {
    const wrapper = await loadSound()
    const player = await startPreview(wrapper)
    expect(mocks.setSinkId).toHaveBeenCalledWith('media')
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'other', label: 'Other' }
    await flushPromises()
    expect(mocks.setSinkId).toHaveBeenLastCalledWith('other')
    const pendingFrame = mocks.nextFrame
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Discard')!
      .trigger('click')
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.pause).toHaveBeenCalledOnce()
    expect(player.hasAttribute('src')).toBe(false)
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(pendingFrame)
    expect(mocks.frames.size).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    mocks.setSinkId.mockClear()
    mocks.voice.settings.value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    await flushPromises()
    expect(mocks.setSinkId).not.toHaveBeenCalled()
  })

  it('tracks the actual media position through buffering and loops, with the crop offset', async () => {
    const wrapper = await loadSound()
    mocks.regionUpdated!({ start: 0.25, end: 0.75 })
    await flushPromises()
    const player = await startPreview(wrapper)
    expect(mocks.setTime).toHaveBeenLastCalledWith(0.25)
    player.currentTime = 0.125
    tick()
    expect(mocks.setTime).toHaveBeenLastCalledWith(0.375)
    tick()
    expect(mocks.setTime).toHaveBeenLastCalledWith(0.375)
    player.currentTime = 0.01
    tick()
    expect(mocks.setTime).toHaveBeenLastCalledWith(0.26)
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Pause')!
      .trigger('click')
    expect(mocks.frames.size).toBe(0)
    expect(mocks.setTime).toHaveBeenLastCalledWith(0.25)
  })

  it('waits for output routing and playback before animating, and cancels a pending preview', async () => {
    let routed!: () => void
    const routing = new Promise<void>(resolve => {
      routed = resolve
    })
    mocks.setSinkId.mockReturnValue(routing)
    let played!: () => void
    mocks.play.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          played = resolve
        }),
    )
    const wrapper = await loadSound()
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Play selection')!
      .trigger('click')
    await vi.waitFor(() => expect(mocks.setSinkId).toHaveBeenCalled())
    expect(mocks.play).not.toHaveBeenCalled()
    expect(mocks.frames.size).toBe(0)
    routed()
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalled())
    expect(mocks.frames.size).toBe(0)
    const slider = wrapper.findComponent({ name: 'USlider' })
    slider.vm.$emit('update:modelValue', 50)
    await flushPromises()
    played()
    await flushPromises()
    expect(mocks.frames.size).toBe(0)
    expect(wrapper.findAll('button').some(button => button.text() === 'Pause')).toBe(false)
    expect(mocks.pause).toHaveBeenCalledOnce()
  })

  it('cleans up and reports blocked playback rather than leaving an orphaned player', async () => {
    mocks.play.mockRejectedValueOnce(new Error('Playback blocked'))
    const wrapper = await loadSound()
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Play selection')!
      .trigger('click')
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Playback blocked' })))
    expect(mocks.frames.size).toBe(0)
    expect(mocks.pause).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('rejects surround files without silently downmixing and closes the decoding context', async () => {
    mocks.decoded.numberOfChannels = 6
    const wrapper = await mountInApp(Soundboard)
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'surround.wav')] })
    await input.trigger('change')
    await flushPromises()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Choose a mono or stereo file; surround audio is not supported' }))
  })
})
