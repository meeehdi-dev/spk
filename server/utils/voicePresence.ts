/** Who is in which voice channel (in memory; one replica only). One session per account. */
export interface VoiceFlags { muted: boolean, deafened: boolean, speaking: boolean, cam: boolean, screen: boolean }
export interface VoicePresence extends VoiceFlags { userId: string, channelId: string }
interface Session extends VoicePresence { sid: string, owner: unknown }

const sessions = new Map<string, Session>()
const pub = ({ sid: _sid, owner: _owner, ...p }: Session): VoicePresence => p

/** `replacedSid` is set when the account was in voice under another session (the caller kicks it). Re-joining with the same sid is a reconnect. */
export function joinVoice(userId: string, channelId: string, sid: string, owner: unknown) {
  const old = sessions.get(userId)
  sessions.set(userId, { userId, channelId, sid, owner, muted: old?.sid === sid ? old.muted : false, deafened: old?.sid === sid ? old.deafened : false, speaking: false, cam: old?.sid === sid ? old.cam : false, screen: old?.sid === sid ? old.screen : false })
  return { presence: pub(sessions.get(userId)!), replacedSid: old && old.sid !== sid ? old.sid : undefined }
}

export function updateVoice(userId: string, sid: string, f: Partial<VoiceFlags>) {
  const s = sessions.get(userId)
  if (!s || s.sid !== sid) return null
  for (const k of ['muted', 'deafened', 'speaking', 'cam', 'screen'] as const) if (typeof f[k] === 'boolean') s[k] = f[k]
  if (s.muted) s.speaking = false
  return pub(s)
}

/** Ends the session if `sid` is still the current one (a late leave from a replaced session does nothing). */
export function leaveVoice(userId: string, sid: string) {
  if (sessions.get(userId)?.sid !== sid) return null
  const { channelId } = sessions.get(userId)!
  sessions.delete(userId)
  return { userId, channelId }
}

/** The socket that owns sessions closed: they are ghosts now. */
export function dropVoiceOwner(owner: unknown) {
  const gone: Array<{ userId: string, channelId: string }> = []
  for (const [userId, s] of sessions)
    if (s.owner === owner) {
      sessions.delete(userId)
      gone.push({ userId, channelId: s.channelId })
    }
  return gone
}

/** All current sessions. */
export const voiceSnapshot = (): VoicePresence[] => [...sessions.values()].map(pub)

/** Channel and everyone in it, if `sid` is the user's current session (the membership check for `voice:sound`). */
export function soundAudience(userId: string, sid: string) {
  const s = sessions.get(userId)
  if (!s || s.sid !== sid) return null
  return [...sessions.values()].filter(x => x.channelId === s.channelId).map(x => x.userId)
}

/** The user's current session, if any. */
export const sessionOf = (userId: string) => {
  const s = sessions.get(userId)
  return s ? { sid: s.sid, channelId: s.channelId } : null
}

/** Everyone in a voice channel. */
export const sessionsIn = (channelId: string) => [...sessions.values()].filter(s => s.channelId === channelId).map(s => ({ userId: s.userId, sid: s.sid }))
