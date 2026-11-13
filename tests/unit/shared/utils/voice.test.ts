import { describe, expect, it } from 'vitest'

import {
  cameraConstraints,
  effectiveVolume,
  initialMute,
  isScreenQuality,
  matchDevice,
  SCREEN_AUDIO_CAPTURE,
  SCREEN_AUDIO_PUBLISH,
  screenQualityFromName,
  screenQualityName,
  screenShareOptions,
  sensitivityToDb,
  toggleDeafen,
  toggleMute,
  userVolume,
  VOICE_PUBLISH_DEFAULTS,
} from '#shared/utils/voice'

describe('mute / deafen', () => {
  it('deafening also mutes; undeafening restores the earlier mute state', () => {
    let s = toggleDeafen(initialMute())
    expect(s).toMatchObject({ muted: true, deafened: true })
    expect(toggleDeafen(s)).toMatchObject({ muted: false, deafened: false })
    s = toggleDeafen(toggleMute(initialMute())) // muted, then deafened
    expect(toggleDeafen(s)).toMatchObject({ muted: true, deafened: false })
  })
  it('unmuting while deafened also undeafens', () => {
    const s = toggleMute(toggleDeafen(initialMute()))
    expect(s).toMatchObject({ muted: false, deafened: false })
  })
  it('mute toggles on its own', () => {
    expect(toggleMute(toggleMute(initialMute())).muted).toBe(false)
  })
})

describe('device matching', () => {
  const devs = [
    { deviceId: 'a', label: 'Built-in' },
    { deviceId: 'b', label: 'USB Mic' },
  ]
  it('uses the saved id first', () => expect(matchDevice({ deviceId: 'b', label: 'x' }, devs)).toEqual({ deviceId: 'b', how: 'id' }))
  it('falls back to the label when the id changed', () =>
    expect(matchDevice({ deviceId: 'zzz', label: 'USB Mic' }, devs)).toEqual({ deviceId: 'b', how: 'label' }))
  it('falls back to the default', () => {
    expect(matchDevice({ deviceId: 'zzz', label: 'Gone' }, devs)).toEqual({ how: 'default' })
    expect(matchDevice(undefined, devs)).toEqual({ how: 'default' })
  })
  it('ignores a blank label', () => expect(matchDevice({ deviceId: 'zzz', label: '' }, [{ deviceId: 'q', label: '' }])).toEqual({ how: 'default' }))
})

describe('sensitivity', () => {
  it('maps sensitivity to a threshold', () => {
    expect(sensitivityToDb(50)).toBe(-50)
    expect(sensitivityToDb(100)).toBeLessThan(sensitivityToDb(0))
  })
})

describe('screen share audio', () => {
  it('is captured without any processing', () => expect(Object.values(SCREEN_AUDIO_CAPTURE)).toEqual([false, false, false]))
})

describe('screen share and per-user volume', () => {
  it('round-trips advertised screen quality and rejects unknown or unsupported names', () => {
    const quality = { height: 1440, fps: 5 } as const
    expect(screenQualityFromName(screenQualityName(quality))).toEqual(quality)
    for (const name of [undefined, '', 'screen', 'other:1440:5', 'spk:screen:900:5', 'spk:screen:1440:24', 'spk:screen:1440:5:extra']) {
      expect(screenQualityFromName(name)).toBeUndefined()
    }
  })
  it('derives screen share encoding from resolution and fps', () => {
    expect(screenShareOptions({ height: 1440, fps: 5 })).toMatchObject({
      contentHint: 'detail',
      degradationPreference: 'maintain-resolution',
      codec: 'vp9',
      maxBitrate: 5_000_000,
      resolution: { width: 2560, height: 1440, frameRate: 5 },
    })
    expect(screenShareOptions({ height: 1080, fps: 60 })).toMatchObject({
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
      maxBitrate: 15_000_000,
      resolution: { width: 1920, height: 1080, frameRate: 60 },
    })
    expect(screenShareOptions({ height: 720, fps: 30 }).maxBitrate).toBeLessThan(screenShareOptions({ height: 1080, fps: 30 }).maxBitrate)
    expect([isScreenQuality('eco'), isScreenQuality({ height: 1080, fps: 30 }), isScreenQuality({ height: 900, fps: 30 })]).toEqual([false, true, false])
  })
  it('publishes single-layer, high-bitrate camera, mic and screen audio', () => {
    expect(VOICE_PUBLISH_DEFAULTS).toMatchObject({
      simulcast: false,
      videoEncoding: { maxBitrate: 6_000_000 },
      audioPreset: { maxBitrate: 128_000 },
      dtx: false,
      red: true,
    })
    expect(cameraConstraints('1080p').height).toEqual({ ideal: 1080, max: 1080 })
    expect(SCREEN_AUDIO_PUBLISH).toMatchObject({ audioPreset: { maxBitrate: 256_000 }, forceStereo: true, dtx: false })
  })
  it('silences on deafen or mute-for-me, else scales by user and output volume', () => {
    const v = userVolume({ a: { screen: 0.5 } }, 'a')
    expect(v).toEqual({ mic: 1, screen: 0.5, muted: false })
    expect(effectiveVolume(false, v, 'screen', 0.5)).toBe(0.25)
    expect(effectiveVolume(true, v, 'mic', 1)).toBe(0)
    expect(effectiveVolume(false, { ...v, muted: true }, 'mic', 1)).toBe(0)
  })
})
