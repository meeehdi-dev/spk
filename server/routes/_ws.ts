import type { Peer } from 'crossws'

import { logFailure } from '../utils/errorLog'
import { isSameOrigin } from '../utils/sameOrigin'

const PING_MS = 20_000
const userOf = new WeakMap<Peer, string>()
const timers = new WeakMap<Peer, ReturnType<typeof setInterval>>()

export default defineWebSocketHandler({
  // Rejects the upgrade unless the session cookie is valid and the user isn't banned.
  async upgrade(request) {
    if (!isSameOrigin(request.headers.get('origin'))) {
      logFailure({ method: 'GET', url: request.url, status: 403, message: 'WebSocket upgrade: cross-origin' })
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const s = await useAuth().api.getSession({ headers: request.headers })
      if (!s) {
        logFailure({ method: 'GET', url: request.url, status: 401, message: 'WebSocket upgrade: not signed in' })
        return new Response('Not signed in', { status: 401 })
      }
      request.context.userId = s.user.id
    } catch (e) {
      logFailure({ method: 'GET', url: request.url, status: 500, message: `WebSocket upgrade: ${(e as Error).message}`, error: e })
      return new Response('Server error', { status: 500 })
    }
  },
  error(peer, e) {
    logFailure({ method: 'WS', url: peer.request?.url ?? '/_ws', status: 500, message: `WebSocket handler: ${e.message}`, userId: peer.context.userId as string | undefined, error: e })
  },
  open(peer) {
    const userId = peer.context.userId as string
    userOf.set(peer, userId)
    const p = addPeer(userId, peer)
    if (p) broadcast({ type: 'presence:update', userId, status: p })
    timers.set(peer, setInterval(() => peer.send(JSON.stringify({ type: 'ping' })), PING_MS))
  },
  message(peer, message) {
    const text = message.text()
    if (text === 'ping') peer.send(JSON.stringify({ type: 'pong' }))
    else handleClientFrame(peer.context.userId as string, text, peer)
  },
  close(peer) {
    clearInterval(timers.get(peer))
    dropVoiceSocket(peer)
    const id = userOf.get(peer)
    const p = id ? removePeer(id, peer) : null
    if (id && p) broadcast({ type: 'presence:update', userId: id, status: p })
  }
})
