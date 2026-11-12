import type { Peer } from 'crossws'

import { and, eq } from 'drizzle-orm'

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

/** The socket closed: whoever it held in voice is gone. */
export function dropVoiceSocket(owner: unknown) {
  for (const g of dropVoiceOwner(owner)) broadcast(presenceFrame(null, g.userId))
}
