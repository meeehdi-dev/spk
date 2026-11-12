import type { Peer } from 'crossws'

import { MANUAL_STATUSES, type ManualStatus } from '../../shared/utils/presence'
import { radioSnapshot } from '../utils/radioState'

const PING_MS = 20_000
const userOf = new WeakMap<Peer, string>()
const heard = new WeakMap<Peer, number>() // last time each peer sent anything
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
      const status = new URL(request.url).searchParams.get('status') as ManualStatus
      if (MANUAL_STATUSES.includes(status)) request.context.status = status
    } catch (e) {
      logFailure({ method: 'GET', url: request.url, status: 500, message: `WebSocket upgrade: ${(e as Error).message}`, error: e })
      return new Response('Server error', { status: 500 })
    }
  },
  error(peer, e) {
    logFailure({
      method: 'WS',
      url: peer.request?.url ?? '/_ws',
      status: 500,
      message: `WebSocket handler: ${e.message}`,
      userId: peer.context.userId as string | undefined,
      error: e,
    })
  },
  open(peer) {
    const userId = peer.context.userId as string
    userOf.set(peer, userId)
    const p = addPeer(userId, peer, peer.context.status as ManualStatus | undefined)
    if (p) broadcast({ type: 'presence:update', userId, status: p })
    peer.send(JSON.stringify({ type: 'radio:snapshot', channels: radioSnapshot() }))
    heard.set(peer, Date.now())
    timers.set(
      peer,
      setInterval(() => {
        // Silent for over 2 pings (a sleeping laptop, dropped Wi-Fi): terminating runs the close hook's presence and voice cleanup.
        if (Date.now() - (heard.get(peer) ?? 0) > 2 * PING_MS) return peer.terminate()
        peer.send(JSON.stringify({ type: 'ping' }))
      }, PING_MS),
    )
  },
  message(peer, message) {
    heard.set(peer, Date.now())
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
  },
})
