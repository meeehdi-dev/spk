import type { LocalAudioTrack, RemoteAudioTrack, Room } from 'livekit-client'

export interface VoiceDiagnostics {
  mediaRtt: number | null
  jitter: number | null
  packetLoss: number | null
  upload: number | null
  download: number | null
  quality: string
}

interface Counters {
  timestamp: number
  bytesSent?: number
  bytesReceived?: number
  packetsReceived?: number
  packetsLost?: number
}

export async function readIncomingAudio(track: RemoteAudioTrack) {
  // LiveKit's getReceiverStats omits packet counters; use its public WebRTC report instead.
  const report = await track.getRTCStatsReport()
  return [...(report?.values() ?? [])].find(s => s.type === 'inbound-rtp') as RTCInboundRtpStreamStats | undefined
}

export function createVoiceDiagnostics(room: Room) {
  const previous = new WeakMap<LocalAudioTrack | RemoteAudioTrack, Counters>()
  return async (): Promise<VoiceDiagnostics> => {
    const result: VoiceDiagnostics = {
      mediaRtt: null,
      jitter: null,
      packetLoss: null,
      upload: null,
      download: null,
      quality: room.localParticipant.connectionQuality,
    }
    const tracks = [
      ...[...room.localParticipant.audioTrackPublications.values()].flatMap(p => (p.audioTrack ? [{ track: p.audioTrack, local: true as const }] : [])),
      ...[...room.remoteParticipants.values()].flatMap(p =>
        [...p.audioTrackPublications.values()].flatMap(pub => (pub.audioTrack ? [{ track: pub.audioTrack, local: false as const }] : [])),
      ),
    ]
    let received = 0
    let lost = 0
    let hasLoss = false
    await Promise.all(
      tracks.map(async ({ track, local }) => {
        try {
          const stats = local ? await (track as LocalAudioTrack).getSenderStats() : await readIncomingAudio(track as RemoteAudioTrack)
          if (!stats) return
          const before = previous.get(track)
          previous.set(track, stats)
          if (stats.jitter !== undefined && Number.isFinite(stats.jitter) && stats.jitter >= 0)
            result.jitter = Math.max(result.jitter ?? 0, stats.jitter * 1000)
          if ('roundTripTime' in stats && typeof stats.roundTripTime === 'number' && Number.isFinite(stats.roundTripTime) && stats.roundTripTime >= 0)
            result.mediaRtt = Math.max(result.mediaRtt ?? 0, stats.roundTripTime * 1000)
          if (!before || stats.timestamp <= before.timestamp) return
          const bytes = 'bytesSent' in stats ? stats.bytesSent : 'bytesReceived' in stats ? stats.bytesReceived : undefined
          const oldBytes = local ? before.bytesSent : before.bytesReceived
          if (bytes !== undefined && oldBytes !== undefined && bytes >= oldBytes) {
            const key = local ? 'upload' : 'download'
            result[key] = (result[key] ?? 0) + ((bytes - oldBytes) * 8) / (stats.timestamp - before.timestamp)
          }
          if (
            !local &&
            'packetsReceived' in stats &&
            stats.packetsReceived !== undefined &&
            before.packetsReceived !== undefined &&
            stats.packetsLost !== undefined &&
            before.packetsLost !== undefined
          ) {
            const delta = stats.packetsReceived - before.packetsReceived
            if (delta >= 0) {
              received += delta
              lost += Math.max(0, stats.packetsLost - before.packetsLost)
              hasLoss = true
            }
          }
        } catch {
          // A track can end during a stats read; leave its measurements unavailable.
        }
      }),
    )
    if (hasLoss && received + lost > 0) result.packetLoss = (lost / (received + lost)) * 100
    return result
  }
}
