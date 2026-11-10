import { RoomServiceClient } from 'livekit-server-sdk'
import { broadcast, peersOf, sendToUser } from './peers'
import { leaveVoice, sessionOf, sessionsIn } from './voicePresence'

/** Best effort: LiveKit may be down or unconfigured; the app-side session is already gone. */
async function livekit(fn: (c: RoomServiceClient) => Promise<unknown>) {
  const cfg = useRuntimeConfig()
  if (!cfg.livekit.apiKey || !cfg.livekit.apiSecret || !cfg.public.livekitUrl) return
  try { await fn(new RoomServiceClient(cfg.public.livekitUrl.replace(/^ws/, 'http'), cfg.livekit.apiKey, cfg.livekit.apiSecret)) } catch (e) { console.warn('[livekit] admin call failed', (e as Error).message) }
}

/** Ends the user's voice session on the server, tells their client, and removes them from the LiveKit room. */
export function disconnectVoice(userId: string, reason: string) {
  const s = sessionOf(userId)
  if (!s) return false
  leaveVoice(userId, s.sid)
  broadcast({ type: 'voice:presence', channelId: null, userId })
  sendToUser(userId, { type: 'voice:disconnect', sid: s.sid, reason })
  void livekit(c => c.removeParticipant(s.channelId, userId))
  return true
}

/** A voice channel is being deleted: everyone in it leaves (with a toast on their side). */
export function disconnectChannel(channelId: string) {
  for (const s of sessionsIn(channelId)) disconnectVoice(s.userId, 'This voice channel was deleted')
  void livekit(c => c.deleteRoom(channelId))
}

/** Tells the client to switch rooms; it re-joins under the same session. Returns false if they aren't in voice (or are already there). */
export function moveVoice(userId: string, channelId: string) {
  const s = sessionOf(userId)
  if (!s || s.channelId === channelId) return false
  sendToUser(userId, { type: 'voice:move', sid: s.sid, channelId })
  return true
}

/** A ban ends everything live: voice, and every open socket. */
export function endUserConnections(userId: string) {
  disconnectVoice(userId, 'You have been banned')
  sendToUser(userId, { type: 'banned' })
  for (const p of [...peersOf(userId)]) p.close(4003, 'banned')
}
