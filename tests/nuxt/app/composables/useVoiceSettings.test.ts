import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { playVoiceSound, useVoiceSettings } from '~/composables/useVoiceSettings'

const media = vi.hoisted(() => {
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  const oscillator = { frequency: { value: 0 }, connect: () => gain, start: vi.fn(), stop: vi.fn() }
  const context = { currentTime: 0, createOscillator: () => oscillator, createGain: () => gain }
  return { gain, context, destination: {} }
})
vi.mock('~/utils/media-audio', () => ({
  playMediaAudio: (play: (context: typeof media.context, destination: object) => void) => play(media.context, media.destination),
}))

let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  localStorage.clear()
})

const readSettings = () => scope.run(() => useVoiceSettings())!

describe('voice action sounds', () => {
  it('routes notes through media output and preserves the off switch and forced preview', async () => {
    const settings = readSettings()
    settings.value.sounds.join = { on: false, volume: 0.5 }
    await nextTick()
    scope.run(() => playVoiceSound('join'))
    expect(media.gain.connect).not.toHaveBeenCalled()
    scope.run(() => playVoiceSound('join', true, true))
    expect(media.gain.connect).toHaveBeenCalledTimes(2)
    expect(media.gain.connect).toHaveBeenCalledWith(media.destination)
    expect(media.gain.gain.setValueAtTime).toHaveBeenCalledWith(0.15, 0)
  })
})

describe('media output preference', () => {
  it('ignores the old screen output preference', () => {
    localStorage.setItem('spk:voice', JSON.stringify({ screenSpeaker: { deviceId: 'old', label: 'Old output' } }))
    expect(readSettings().value.mediaSpeaker).toBeUndefined()
  })

  it('persists the renamed media output preference', async () => {
    readSettings().value.mediaSpeaker = { deviceId: 'media', label: 'Media' }
    await nextTick()
    scope.stop()
    scope = effectScope()
    expect(readSettings().value.mediaSpeaker).toEqual({ deviceId: 'media', label: 'Media' })
  })
})

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
