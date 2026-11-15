import type { Room } from 'livekit-client'

import { expect, it, vi } from 'vitest'

import { createVoiceDiagnostics } from '~/utils/voice-diagnostics'

function fixture() {
  const sender = vi.fn()
  const receiver = vi.fn()
  const room = {
    localParticipant: { connectionQuality: 'excellent', audioTrackPublications: new Map([['mic', { audioTrack: { getSenderStats: sender } }]]) },
    remoteParticipants: new Map([
      [
        'other',
        {
          audioTrackPublications: new Map([
            [
              'mic',
              {
                audioTrack: {
                  getRTCStatsReport: async () => {
                    const stats = await receiver()
                    return new Map(stats ? [['audio', { ...stats, type: 'inbound-rtp' }]] : [])
                  },
                },
              },
            ],
          ]),
        },
      ],
    ]),
  }
  return { sender, receiver, collect: createVoiceDiagnostics(room as unknown as Room) }
}

it('converts seconds to ms and measures interval bitrate and packet loss rather than lifetime totals', async () => {
  const { sender, receiver, collect } = fixture()
  sender.mockResolvedValue({ timestamp: 1000, bytesSent: 1000, roundTripTime: 0.05, jitter: 0.002 })
  receiver.mockResolvedValue({ timestamp: 1000, bytesReceived: 2000, packetsReceived: 900, packetsLost: 100, jitter: 0.01 })
  expect(await collect()).toEqual({ quality: 'excellent', mediaRtt: 50, jitter: 10, upload: null, download: null, packetLoss: null })
  sender.mockResolvedValue({ timestamp: 3000, bytesSent: 9000, roundTripTime: 0, jitter: 0 })
  receiver.mockResolvedValue({ timestamp: 3000, bytesReceived: 18000, packetsReceived: 998, packetsLost: 102, jitter: 0.005 })
  expect(await collect()).toEqual({ quality: 'excellent', mediaRtt: 0, jitter: 5, upload: 32, download: 64, packetLoss: 2 })
})

it('leaves unsupported or ended tracks unavailable and ignores reset counters', async () => {
  const { sender, receiver, collect } = fixture()
  sender.mockRejectedValue(new Error('ended'))
  receiver.mockResolvedValue(undefined)
  expect(await collect()).toEqual({ quality: 'excellent', mediaRtt: null, jitter: null, upload: null, download: null, packetLoss: null })
  receiver.mockResolvedValue({ timestamp: 1000, bytesReceived: 1000, packetsReceived: 100, packetsLost: 1 })
  await collect()
  receiver.mockResolvedValue({ timestamp: 3000, bytesReceived: 0, packetsReceived: 0, packetsLost: 0 })
  const reset = await collect()
  expect(reset.download).toBeNull()
  expect(reset.packetLoss).toBeNull()
})
