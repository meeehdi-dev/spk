// @vitest-environment happy-dom
import { LocalAudioTrack, Track } from 'livekit-client'
import { afterEach, expect, it, vi } from 'vitest'

import { VOICE_PUBLISH_DEFAULTS } from '../shared/utils/voice'

function nativeTrack() {
  return Object.assign(new EventTarget(), {
    id: crypto.randomUUID(),
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    getConstraints: () => ({ deviceId: 'mac' }),
    getSettings: () => ({ deviceId: 'mac' }),
    applyConstraints: vi.fn(async (_constraints: MediaTrackConstraints) => {}),
    stop: vi.fn(function (this: { readyState: string }) {
      this.readyState = 'ended'
    }),
  })
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses LiveKit to release muted capture and reacquire the selected input with updated constraints', async () => {
  vi.spyOn(LocalAudioTrack.prototype, 'checkForSilence').mockResolvedValue(false)
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(public tracks: MediaStreamTrack[] = []) {}
      getTracks() {
        return this.tracks
      }
    },
  )
  const first = nativeTrack(),
    replacement = nativeTrack()
  const capture = vi.fn(async () => ({ getTracks: () => [replacement] }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: capture } })
  const track = new LocalAudioTrack(first as unknown as MediaStreamTrack, { deviceId: 'mac' }, false)
  track.source = Track.Source.Microphone
  track.stopOnMute = VOICE_PUBLISH_DEFAULTS.stopMicTrackOnMute
  try {
    await track.mute()
    expect(first.readyState).toBe('ended')
    await track.setDeviceId('external')
    await track.applyConstraints({ echoCancellation: false, noiseSuppression: true })
    expect(capture).not.toHaveBeenCalled()
    await track.unmute()
    expect(capture).toHaveBeenCalledExactlyOnceWith({ audio: { deviceId: 'external', echoCancellation: false, noiseSuppression: true }, video: false })
    expect(track.isMuted).toBe(false)
    await track.mute()
    expect(replacement.readyState).toBe('ended')
  } finally {
    track.stop()
  }
})
