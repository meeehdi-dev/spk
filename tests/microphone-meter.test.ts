// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { transpile } from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, watch } from 'vue'

import { matchDevice } from '../shared/utils/voice'

const script = readFileSync('app/components/settings/Voice.vue', 'utf8')
const meter = script.slice(script.indexOf('// Level meter'), script.indexOf('// Camera preview'))
const setup = new Function('ref', 'watch', 'v', 's', 'matchDevice', 'useToast', `${transpile(meter)}; return { testing, level }`)
let scope: ReturnType<typeof effectScope>
let getUserMedia: ReturnType<typeof vi.fn>
const toast = vi.fn()
const close = vi.fn(async () => {})
const createAnalyser = vi.fn(() => ({ fftSize: 0, getFloatTimeDomainData: vi.fn() }))
const stream = () => {
  const stop = vi.fn()
  return { stop, getTracks: () => [{ stop }] }
}
function mount() {
  const v = { connecting: ref(false), channelId: ref<string | null>(null), devices: ref({ mics: [{ deviceId: 'mac', label: 'MacBook' }] }) }
  scope = effectScope()
  const state = scope.run(() => setup(ref, watch, v, ref({ mic: { deviceId: 'mac', label: 'MacBook' } }), matchDevice, () => ({ add: toast })))!
  return { ...state, v }
}
beforeEach(() => {
  vi.clearAllMocks()
  getUserMedia = vi.fn()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
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
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('microphone test capture', () => {
  it.each(['stop', 'unmount', 'join'])('releases late capture after %s', async action => {
    let resolve!: (value: ReturnType<typeof stream>) => void
    getUserMedia.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r
        }),
    )
    const { testing, v } = mount()
    testing.value = true
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: 'mac' } })
    if (action === 'stop') testing.value = false
    else if (action === 'unmount') scope.stop()
    else v.connecting.value = true
    const input = stream()
    resolve(input)
    await Promise.resolve()
    expect(input.stop).toHaveBeenCalledOnce()
    expect(createAnalyser).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('stops active capture and closes the meter when a call starts', async () => {
    const input = stream()
    getUserMedia.mockResolvedValue(input)
    const { testing, v } = mount()
    testing.value = true
    await Promise.resolve()
    v.channelId.value = 'call'
    expect(testing.value).toBe(false)
    expect(input.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })

  it('releases acquired resources when meter setup fails', async () => {
    const input = stream()
    getUserMedia.mockResolvedValue(input)
    createAnalyser.mockImplementationOnce(() => {
      throw new Error('Audio setup failed')
    })
    const { testing } = mount()
    testing.value = true
    await Promise.resolve()
    expect(testing.value).toBe(false)
    expect(input.stop).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledOnce()
  })
})
