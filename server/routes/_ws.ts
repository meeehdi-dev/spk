import type { Peer } from 'crossws'

import { MANUAL_STATUSES, type ManualStatus } from '../../shared/utils/presence'
import { radioSnapshot } from '../utils/radioState'

const PING_MS = 20_000
const userOf = new WeakMap<Peer, string>()
const timers = new WeakMap<Peer, ReturnType<typeof setInterval>>()
// openedAt / lastSeen let the close log tell a silent death (long quiet) from an active socket being cut.
const openedAt = new WeakMap<Peer, number>()
const lastSeen = new WeakMap<Peer, number>()

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
    openedAt.set(peer, Date.now())
    lastSeen.set(peer, Date.now())
    const p = addPeer(userId, peer, peer.context.status as ManualStatus | undefined)
    if (p) broadcast({ type: 'presence:update', userId, status: p })
    peer.send(JSON.stringify({ type: 'radio:snapshot', channels: radioSnapshot() }))
    timers.set(
      peer,
      setInterval(() => {
        // Keep proxies alive, but never disconnect a tab for delayed JavaScript replies.
        peer.send(JSON.stringify({ type: 'ping' }))
      }, PING_MS),
    )
  },
  message(peer, message) {
    lastSeen.set(peer, Date.now())
    const text = message.text()
    if (text === 'ping') peer.send(JSON.stringify({ type: 'pong' }))
    else handleClientFrame(peer.context.userId as string, text, peer)
  },
  close(peer, details) {
    clearInterval(timers.get(peer))
    const now = Date.now()
    const reason = (details?.reason ?? '').replace(/[^\w .:-]/g, '').slice(0, 60) || '-'
    console.info(
      `[ws] close user=${userOf.get(peer) ?? '-'} code=${details?.code ?? '-'} reason=${reason} livedMs=${now - (openedAt.get(peer) ?? now)} quietMs=${now - (lastSeen.get(peer) ?? now)}`,
    )
    dropVoiceSocket(peer)
    const id = userOf.get(peer)
    const p = id ? removePeer(id, peer) : null
    if (id && p) broadcast({ type: 'presence:update', userId: id, status: p })
  },
})
