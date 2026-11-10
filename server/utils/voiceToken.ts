import { AccessToken } from 'livekit-server-sdk'

/** LiveKit join token: the room is the voice channel id, the identity is the user id. */
export function createVoiceToken(o: { apiKey: string, apiSecret: string, userId: string, name: string, channelId: string }) {
  const t = new AccessToken(o.apiKey, o.apiSecret, { identity: o.userId, name: o.name, ttl: '6h' })
  t.addGrant({ roomJoin: true, room: o.channelId, canPublish: true, canSubscribe: true, canPublishData: false })
  return t.toJwt()
}
