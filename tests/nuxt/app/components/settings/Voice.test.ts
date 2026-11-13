import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { cameraConstraints } from '#shared/utils/voice'
import Voice from '~/components/settings/Voice.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const toast = vi.hoisted(() => vi.fn())
mockNuxtImport('useToast', () => () => ({ add: toast }))

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
const close = vi.fn(async () => {})
const createAnalyser = vi.fn(() => ({ fftSize: 0, getFloatTimeDomainData: vi.fn() }))
const stream = () => {
  const stop = vi.fn()
  return { stop, value: { getTracks: () => [{ stop }] } as unknown as MediaStream }
}

beforeEach(() => {
  vi.resetAllMocks()
  close.mockResolvedValue(undefined)
  createAnalyser.mockImplementation(() => ({ fftSize: 0, getFloatTimeDomainData: vi.fn() }))
  const devices = [
    { deviceId: 'mac', kind: 'audioinput', label: 'MacBook' },
    { deviceId: 'external', kind: 'videoinput', label: 'Camera' },
  ]
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: async () => devices } })
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'AudioContext',
    class {
      close = close
      createAnalyser = createAnalyser
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
    },
  )
  const v = useVoice()
  v.settings.value = {
    ...v.settings.value,
    cameraResolution: 'auto',
    mic: { deviceId: 'mac', label: 'MacBook' },
    camera: { deviceId: 'external', label: 'Camera' },
  }
})
afterEach(() => {
  const v = useVoice()
  v.connecting.value = false
  v.channelId.value = null
  v.camOn.value = false
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function mountSettings() {
  const wrapper = await mountInApp(Voice)
  await flushPromises()
  const click = async (label: string) => {
    await wrapper
      .findAll('button')
      .find(b => b.text() === label)!
      .trigger('click')
    await nextTick()
  }
  const video = wrapper.find('video').element as HTMLVideoElement
  // happy-dom only stores real MediaStream instances in srcObject.
  Object.defineProperty(video, 'srcObject', { value: null, writable: true })
  return { wrapper, click, video, v: useVoice() }
}

describe('microphone test capture', () => {
  it.each(['stop', 'unmount', 'join'])('releases late capture after %s', async action => {
    let resolve!: (value: MediaStream) => void
    getUserMedia.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r
        }),
    )
    const { wrapper, click, v } = await mountSettings()
    await click('Test microphone')
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: 'mac' } })
    if (action === 'stop') await click('Stop')
    else if (action === 'unmount') wrapper.unmount()
    else v.connecting.value = true
    const input = stream()
    resolve(input.value)
    await flushPromises()
    expect(input.stop).toHaveBeenCalledOnce()
    expect(createAnalyser).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('stops active capture and closes the meter when a call starts', async () => {
    const input = stream()
    getUserMedia.mockResolvedValue(input.value)
    const { wrapper, click, v } = await mountSettings()
    await click('Test microphone')
    await flushPromises()
    v.channelId.value = 'call'
    await nextTick()
    expect(wrapper.text()).toContain('Test microphone')
    expect(input.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })

  it('releases acquired resources when meter setup fails', async () => {
    const input = stream()
    getUserMedia.mockResolvedValue(input.value)
    createAnalyser.mockImplementationOnce(() => {
      throw new Error('Audio setup failed')
    })
    const { wrapper, click } = await mountSettings()
    await click('Test microphone')
    await flushPromises()
    expect(wrapper.text()).toContain('Test microphone')
    expect(input.stop).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledOnce()
  })
})

describe('camera preview', () => {
  it('updates an active preview with the chosen resolution and releases previous capture', async () => {
    const first = stream(),
      second = stream()
    getUserMedia.mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value)
    const { wrapper, click, video, v } = await mountSettings()
    await click('Preview camera')
    await flushPromises()
    expect(video.srcObject).toBe(first.value)
    v.settings.value.cameraResolution = '360p'
    await flushPromises()
    expect(first.stop).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: { ...cameraConstraints('360p'), deviceId: 'external' } })
    expect(video.srcObject).toBe(second.value)
    wrapper.unmount()
    expect(second.stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
  })

  it.each(['stop', 'unmount', 'call'])('releases late preview capture after %s', async action => {
    let resolve!: (stream: MediaStream) => void
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise(r => {
          resolve = r
        }),
    )
    const { wrapper, click, video, v } = await mountSettings()
    await click('Preview camera')
    if (action === 'stop') await click('Stop preview')
    else if (action === 'call') v.camOn.value = true
    else wrapper.unmount()
    await nextTick()
    const input = stream()
    resolve(input.value)
    await flushPromises()
    expect(input.stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })
})
