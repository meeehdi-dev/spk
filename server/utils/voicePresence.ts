/** Who is in which voice channel (in memory; one replica only). One session per account. */
export interface VoiceFlags {
  muted: boolean
  deafened: boolean
  speaking: boolean
  cam: boolean
  screen: boolean
  /** User ids whose camera / screen this session is watching. */
  watching: string[]
}
export const MAX_WATCHING = 50
export interface VoicePresence extends VoiceFlags {
  userId: string
  channelId: string
}
interface Session extends VoicePresence {
  sid: string
  owner: unknown
  /** Hidden from everyone until the client reports LiveKit connected. */
  ready: boolean
}

const sessions = new Map<string, Session>()
const pub = ({ sid: _sid, owner: _owner, ready: _ready, ...p }: Session): VoicePresence => p

/**
 * `replacedSid` is set when the account was in voice under another session (the caller kicks it). Re-joining with the same sid is a reconnect.
 * The session is visible at once if `ready`, or when it replaces a visible session in the same channel (no blink); `replacedVisible` tells the caller to announce the old one gone.
 */
export function joinVoice(userId: string, channelId: string, sid: string, owner: unknown, ready = true) {
  const old = sessions.get(userId)
  const visible = ready || (!!old?.ready && old.channelId === channelId)
  sessions.set(userId, {
    userId,
    channelId,
    sid,
    owner,
    muted: old?.sid === sid ? old.muted : false,
    deafened: old?.sid === sid ? old.deafened : false,
    speaking: false,
    cam: old?.sid === sid ? old.cam : false,
    screen: old?.sid === sid ? old.screen : false,
    watching: [],
    ready: visible,
  })
  return { presence: pub(sessions.get(userId)!), visible, replacedVisible: !!old?.ready, replacedSid: old && old.sid !== sid ? old.sid : undefined }
}

/** The client is connected to LiveKit: show the session. Returns its presence only when it just became visible. */
export function readyVoice(userId: string, sid: string) {
  const s = sessions.get(userId)
  if (!s || s.sid !== sid || s.ready) return null
  s.ready = true
  return pub(s)
}

export function updateVoice(userId: string, sid: string, f: Partial<Omit<VoiceFlags, 'watching'>> & { watching?: unknown }) {
  const s = sessions.get(userId)
  if (!s || s.sid !== sid) return null
  for (const k of ['muted', 'deafened', 'speaking', 'cam', 'screen'] as const) if (typeof f[k] === 'boolean') s[k] = f[k]
  if (Array.isArray(f.watching)) s.watching = f.watching.filter((id): id is string => typeof id === 'string' && id.length <= 64).slice(0, MAX_WATCHING)
  if (s.muted) s.speaking = false
  return s.ready ? pub(s) : null // a hidden session keeps its state but isn't announced
}

/** Ends the session if `sid` is still the current one (a late leave from a replaced session does nothing). */
export function leaveVoice(userId: string, sid: string) {
  if (sessions.get(userId)?.sid !== sid) return null
  const { channelId, ready } = sessions.get(userId)!
  sessions.delete(userId)
  return { userId, channelId, ready }
}

/** The socket that owns sessions closed: they are ghosts now. */
export function dropVoiceOwner(owner: unknown) {
  const gone: Array<{ userId: string; channelId: string }> = []
  for (const [userId, s] of sessions)
    if (s.owner === owner) {
      sessions.delete(userId)
      if (s.ready) gone.push({ userId, channelId: s.channelId })
    }
  return gone
}

/** All current sessions. */
export const voiceSnapshot = (): VoicePresence[] => [...sessions.values()].filter(s => s.ready).map(pub)

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
