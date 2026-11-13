// @vitest-environment happy-dom
import { useLocalStorage } from '@vueuse/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { useVoiceSettings } from '../app/composables/useVoiceSettings'

let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  localStorage.clear()
  scope = effectScope()
  vi.stubGlobal('useLocalStorage', useLocalStorage)
})

afterEach(() => {
  scope.stop()
  localStorage.clear()
  vi.unstubAllGlobals()
})

const readSettings = () => scope.run(() => useVoiceSettings())!

describe('voice settings radio volume', () => {
  it('starts fresh storage at 10%', () => {
    expect(readSettings().value.radioVolume).toBe(0.1)
  })

  it('adds 10% to older settings without changing saved preferences', () => {
    localStorage.setItem('spk:voice', JSON.stringify({ outputVolume: 0.4, noise: 'off' }))

    expect(readSettings().value).toMatchObject({ radioVolume: 0.1, outputVolume: 0.4, noise: 'off' })
  })

  it.each([0, 0.3, 0.5])('preserves a saved radio volume of %s', radioVolume => {
    localStorage.setItem('spk:voice', JSON.stringify({ radioVolume }))

    expect(readSettings().value.radioVolume).toBe(radioVolume)
  })

  it('retains a changed volume when settings are opened again', async () => {
    readSettings().value.radioVolume = 0.3
    await nextTick()
    scope.stop()
    scope = effectScope()

    expect(readSettings().value.radioVolume).toBe(0.3)
  })
})

describe('webcam resolution settings', () => {
  it('defaults new and older settings to Auto', () => {
    expect(readSettings().value.cameraResolution).toBe('auto')
    localStorage.setItem('spk:voice', JSON.stringify({ noise: 'off' }))
    expect(readSettings().value).toMatchObject({ cameraResolution: 'auto', noise: 'off' })
  })

  it.each(['auto', '360p', '720p', '1080p'])('restores the saved %s choice', cameraResolution => {
    localStorage.setItem('spk:voice', JSON.stringify({ cameraResolution }))
    expect(readSettings().value.cameraResolution).toBe(cameraResolution)
  })

  it.each([null, 1080, '4k', {}, false])('replaces invalid saved resolution %j with Auto', cameraResolution => {
    localStorage.setItem('spk:voice', JSON.stringify({ cameraResolution }))
    expect(readSettings().value.cameraResolution).toBe('auto')
  })

  it('shares changes between settings instances and persists them', async () => {
    const page = readSettings(),
      menu = readSettings()
    page.value.cameraResolution = '720p'
    await nextTick()
    await nextTick()
    expect(menu.value.cameraResolution).toBe('720p')
    scope.stop()
    scope = effectScope()
    expect(readSettings().value.cameraResolution).toBe('720p')
  })
})
