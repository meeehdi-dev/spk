import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { playVoiceSound, useVoiceSettings } from '~/composables/useVoiceSettings'

const status = vi.hoisted(() => ({ value: 'online' }))
mockNuxtImport('useMyStatus', () => () => status)

const media = vi.hoisted(() => {
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  const oscillator = { frequency: { value: 0 }, connect: () => gain, start: vi.fn(), stop: vi.fn() }
  const context = { currentTime: 0, createOscillator: () => oscillator, createGain: () => gain }
  const play = vi.fn((callback: (audio: typeof context, destination: object) => void) => callback(context, {}))
  return { gain, context, destination: {}, play }
})
vi.mock('~/utils/media-audio', () => ({
  playMediaAudio: media.play,
}))

let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  status.value = 'online'
  media.play.mockImplementation(callback => callback(media.context, media.destination))
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  localStorage.clear()
})

const readSettings = () => scope.run(() => useVoiceSettings())!

describe('voice action sounds', () => {
  it('amplifies voice sounds and forced previews independently of general output', async () => {
    const settings = readSettings()
    settings.value.outputVolume = 0
    settings.value.sounds.join = { on: true, volume: 2 }
    await nextTick()
    scope.run(() => playVoiceSound('join'))
    scope.run(() => playVoiceSound('join', true, true))
    expect(media.gain.gain.setValueAtTime).toHaveBeenCalledWith(0.6, 0)
    expect(media.play).toHaveBeenCalledTimes(2)
  })

  it('silences automatic voice sounds while Busy, preserves previews, and resumes when online', () => {
    status.value = 'busy'
    const kinds = ['join', 'leave', 'mute', 'deafen', 'camera', 'screen', 'watch'] as const
    for (const kind of kinds) scope.run(() => playVoiceSound(kind))
    expect(media.play).not.toHaveBeenCalled()
    scope.run(() => playVoiceSound('join', true, true))
    expect(media.play).toHaveBeenCalledOnce()
    status.value = 'online'
    for (const kind of kinds) scope.run(() => playVoiceSound(kind))
    expect(media.play).toHaveBeenCalledTimes(kinds.length + 1)
  })

  it('rechecks Busy after audio routing finishes', () => {
    media.play.mockImplementationOnce(() => {})
    scope.run(() => playVoiceSound('join'))
    status.value = 'busy'
    media.play.mock.calls[0]![0](media.context, media.destination)
    expect(media.gain.connect).not.toHaveBeenCalled()
  })

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

  it.each([0, 0.3, 0.5, 2])('preserves a saved radio volume of %s', radioVolume => {
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
