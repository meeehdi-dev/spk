// @vitest-environment happy-dom
import type { CameraResolution } from '../shared/utils/voice'

import { readFileSync } from 'node:fs'

import { transpile } from 'typescript'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, markRaw, nextTick, ref, watch } from 'vue'

import { cameraConstraints, matchDevice } from '../shared/utils/voice'

const script = readFileSync('app/components/settings/Voice.vue', 'utf8')
const preview = script.slice(script.indexOf('// Camera preview'), script.indexOf('// Each test'))
const setup = new Function(
  'ref',
  'watch',
  'nextTick',
  'v',
  's',
  'cameraConstraints',
  'matchDevice',
  'useToast',
  `${transpile(preview)}; return { camPreview, videoEl }`,
)
let scope: ReturnType<typeof effectScope>
const capture = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
const toast = vi.fn()
const stream = () => {
  const stop = vi.fn()
  return { stop, value: { getTracks: () => [{ stop }] } as unknown as MediaStream }
}
function mount() {
  scope = effectScope()
  const s = ref({ cameraResolution: 'auto' as CameraResolution, camera: { deviceId: 'external', label: 'Camera' } })
  const v = { camOn: ref(false), devices: ref({ cams: [s.value.camera] }) }
  const state = scope.run(() => setup(ref, watch, nextTick, v, s, cameraConstraints, matchDevice, () => ({ add: toast })))!
  state.videoEl.value = markRaw({ srcObject: null })
  return { ...state, s, v }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: capture } })
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

it('updates an active preview with the chosen resolution and releases previous capture', async () => {
  const first = stream(),
    second = stream()
  capture.mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value)
  const { camPreview, videoEl, s } = mount()
  camPreview.value = true
  await nextTick()
  await nextTick()
  expect(videoEl.value.srcObject).toBe(first.value)
  s.value.cameraResolution = '360p'
  await nextTick()
  await nextTick()
  expect(first.stop).toHaveBeenCalledOnce()
  expect(capture).toHaveBeenLastCalledWith({ video: { ...cameraConstraints('360p'), deviceId: 'external' } })
  expect(videoEl.value.srcObject).toBe(second.value)
  scope.stop()
  expect(second.stop).toHaveBeenCalledOnce()
  expect(videoEl.value.srcObject).toBeNull()
})

it.each(['stop', 'unmount', 'call'])('releases late preview capture after %s', async action => {
  let resolve!: (stream: MediaStream) => void
  capture.mockImplementationOnce(
    () =>
      new Promise(r => {
        resolve = r
      }),
  )
  const { camPreview, videoEl, v } = mount()
  camPreview.value = true
  await nextTick()
  if (action === 'stop') camPreview.value = false
  else if (action === 'call') v.camOn.value = true
  else scope.stop()
  await nextTick()
  const input = stream()
  resolve(input.value)
  await nextTick()
  expect(input.stop).toHaveBeenCalledOnce()
  expect(videoEl.value.srcObject).toBeNull()
  expect(capture).toHaveBeenCalledOnce()
  expect(toast).not.toHaveBeenCalled()
})
