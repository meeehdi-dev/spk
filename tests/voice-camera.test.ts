// @vitest-environment happy-dom
import { createLocalVideoTrack } from 'livekit-client'
import { afterEach, expect, it, vi } from 'vitest'

import { cameraConstraints, CAMERA_RESOLUTIONS } from '../shared/utils/voice'

afterEach(() => vi.unstubAllGlobals())

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
