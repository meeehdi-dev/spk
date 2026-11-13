import { createLocalVideoTrack, LocalAudioTrack, Track } from 'livekit-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CAMERA_RESOLUTIONS, cameraConstraints, VOICE_PUBLISH_DEFAULTS } from '#shared/utils/voice'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('camera constraints through LiveKit', () => {
  it.each(CAMERA_RESOLUTIONS)('passes %s camera limits through LiveKit to browser capture', async resolution => {
    const native = Object.assign(new EventTarget(), {
      id: 'camera',
      kind: 'video',
      enabled: true,
      readyState: 'live',
      getSettings: () => ({ width: 640, height: 360, deviceId: 'camera' }),
      getConstraints: () => ({}),
      stop: vi.fn(),
    })
    const capture = vi.fn(async (_constraints: MediaStreamConstraints) => ({ getTracks: () => [native] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: capture } })
    const track = await createLocalVideoTrack(cameraConstraints(resolution))
    try {
      const constraints = capture.mock.calls[0]![0] as MediaStreamConstraints
      const video = constraints.video as MediaTrackConstraints
      if (resolution === 'auto') {
        expect(video.width).toEqual({ ideal: 1920 })
        expect(video.height).toEqual({ ideal: 1080 })
      } else {
        const height = Number.parseInt(resolution)
        expect(video.height).toEqual({ ideal: height, max: height })
        expect(video.width).toEqual({ ideal: Math.round((height * 16) / 9), max: Math.round((height * 16) / 9) })
      }
      expect(track.mediaStreamTrack.getSettings().height).toBe(360)
    } finally {
      track.stop()
    }
  })
})

describe('microphone publish defaults through LiveKit', () => {
  const nativeTrack = () =>
    Object.assign(new EventTarget(), {
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

  it('releases muted capture and reacquires the selected input with updated constraints', async () => {
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
})
