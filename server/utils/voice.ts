import type { Peer } from 'crossws'

import { and, eq } from 'drizzle-orm'
import { RoomServiceClient, ServerError } from 'livekit-server-sdk'

import { SOUND_COOLDOWN_MS } from '../../shared/utils/sounds'
import { channels } from '../db/schema'
import { getSound } from '../db/sounds'

import { createLimiter } from './limiter'
import { handleRadioFrame } from './radio'

const allowSound = createLimiter(1, SOUND_COOLDOWN_MS) // one soundboard sound per user per 3 s

const presenceFrame = (
  p: { userId: string; channelId: string; muted: boolean; deafened: boolean; speaking: boolean; cam: boolean; screen: boolean; watching: string[] } | null,
  userId: string,
) => ({ type: 'voice:presence', ...(p ?? { channelId: null, userId }) })

/** `voice:*` frames from a signed-in socket. `owner` is the socket: its close clears the session. */
export function handleVoiceFrame(userId: string, m: Record<string, unknown>, owner: unknown) {
  const sid = typeof m.sid === 'string' ? m.sid : ''
  if (!sid) return
  if (['voice:radio:set', 'voice:radio:stop', 'voice:radio:get'].includes(String(m.type))) {
    void handleRadioFrame(userId, m, owner).catch(() => {})
    return
  }
  if (m.type === 'voice:join') {
    const ch =
      typeof m.channelId === 'string'
        ? useDb()
            .select({ id: channels.id })
            .from(channels)
            .where(and(eq(channels.id, m.channelId), eq(channels.type, 'voice')))
            .get()
        : undefined
    if (!ch) return
    const { replacedSid, replacedVisible } = joinVoice(userId, ch.id, sid, owner, m.ready === true)
    // Every tab of the account hears this; the one holding another sid leaves.
    if (replacedSid) sendToUser(userId, { type: 'voice:kicked', sid })
    const p = updateVoice(userId, sid, { muted: !!m.muted, deafened: !!m.deafened, watching: m.watching })
    if (p || replacedVisible) broadcast(presenceFrame(p, userId)) // hidden new session: only retract the old one
    const peer = owner as Peer | undefined
    peer?.send(JSON.stringify({ type: 'voice:joined', sid, channelId: ch.id, nonce: typeof m.nonce === 'string' ? m.nonce : undefined }))
    if (m.ready === true) void handleRadioFrame(userId, { type: 'voice:radio:get', sid }, owner).catch(() => {})
  } else if (m.type === 'voice:ready') {
    const p = readyVoice(userId, sid)
    if (p) broadcast(presenceFrame(p, userId))
    void handleRadioFrame(userId, { type: 'voice:radio:get', sid }, owner).catch(() => {})
  } else if (m.type === 'voice:state') {
    const p = updateVoice(userId, sid, m)
    if (p) broadcast(presenceFrame(p, userId))
  } else if (m.type === 'voice:sound') {
    const audience = soundAudience(userId, sid)
    if (!audience || typeof m.soundId !== 'string' || !getSound(useDb(), m.soundId) || !allowSound(userId)) return
    for (const id of audience) sendToUser(id, { type: 'voice:sound', userId, soundId: m.soundId })
  } else if (m.type === 'voice:leave') {
    if (leaveVoice(userId, sid)?.ready) broadcast(presenceFrame(null, userId))
  }
}

/** An app socket closing says nothing about healthy voice media. Only LiveKit can confirm departure. */
export function dropVoiceSocket(owner: unknown) {
  for (const s of voiceSessionsOf(owner)) if (!s.ready) leaveVoice(s.userId, s.sid)
  if (!voiceSessionsOf(owner).length) return
  const cfg = useRuntimeConfig()
  if (!cfg.livekit.apiKey || !cfg.livekit.apiSecret || !cfg.public.livekitUrl) return
  const client = new RoomServiceClient(cfg.public.livekitUrl.replace(/^ws/, 'http'), cfg.livekit.apiKey, cfg.livekit.apiSecret)
  const check = async () => {
    for (const s of voiceSessionsOf(owner)) {
      try {
        await client.getParticipant(s.channelId, s.userId)
      } catch (e) {
        if (e instanceof ServerError && e.code === 'not_found') {
          // The RPC may finish after a reconnect or another tab has taken ownership.
          if (voiceSessionsOf(owner).includes(s) && leaveVoice(s.userId, s.sid)?.ready) broadcast(presenceFrame(null, s.userId))
        } else console.warn('[livekit] voice departure check failed', (e as Error).message)
      }
    }
    // This polls actual membership, not inactivity: a connected participant never expires.
    if (voiceSessionsOf(owner).length) setTimeout(() => void check(), 20_000).unref()
  }
  void check()
}
