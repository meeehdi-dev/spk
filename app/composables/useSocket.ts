import type { Presence } from '#shared/utils/presence'
import type { RadioState, RadioSummary } from '#shared/utils/radio'

import type { MessageDto } from '../../server/db/messages'
import type { VoicePresence } from '../../server/utils/voicePresence'

export type SocketFrame =
  | { type: 'radio:snapshot'; channels: RadioSummary[] }
  | ({ type: 'radio:update' } & RadioSummary)
  | ({ type: 'voice:radio:state'; sid: string } & RadioState)
  | { type: 'voice:radio:error'; sid: string; channelId?: string; error: string }
  | { type: 'channels:changed' | 'users:changed' | 'banned' | 'signed-out' }
  | { type: 'presence:update'; userId: string; status: Presence }
  | { type: 'unread:update'; channelId: string; unread: number; mentions: number }
  | { type: 'message:new'; message: MessageDto; nonce?: string }
  | { type: 'message:error'; nonce?: string; error: string }
  | { type: 'message:edit'; message: MessageDto }
  | { type: 'message:delete'; channelId: string; id: string }
  | { type: 'message:previews'; channelId: string; messageId: string; previews: MessageDto['previews'] }
  | { type: 'reaction:update'; channelId: string; messageId: string; reactions: MessageDto['reactions'] }
  | { type: 'typing'; channelId: string; userId: string }
  | ({ type: 'voice:presence' } & (VoicePresence | { userId: string; channelId: null }))
  | { type: 'voice:sound'; userId: string; soundId: string }
  | { type: 'voice:joined'; sid: string; channelId: string; nonce: string }
  | { type: 'voice:disconnect'; sid: string; reason: string }
  | { type: 'voice:move'; sid: string; channelId: string }
  | { type: 'voice:kicked'; sid: string }

type Handler = (msg: SocketFrame) => void
const handlers = new Set<Handler>()
const openHandlers = new Set<() => void>()
let ws: WebSocket | undefined
let started = false
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let heartbeat: ReturnType<typeof setTimeout> | undefined
let heard = 0
// The server pings every 20 seconds; tolerate two missed pings and scheduling delays.
const HEARTBEAT_MS = 60_000
const connected = ref(false)
const offline = ref(false)

function resetSocket() {
  clearTimeout(retryTimer)
  retryTimer = undefined
  clearTimeout(heartbeat)
  const old = ws
  ws = undefined // callbacks from an old socket must not affect its replacement
  connected.value = false
  old?.close()
}

function armHeartbeat() {
  clearTimeout(heartbeat)
  heartbeat = setTimeout(() => {
    resetSocket()
    connect()
  }, HEARTBEAT_MS)
}

function connect() {
  if (offline.value || ws) return
  clearTimeout(retryTimer)
  retryTimer = undefined
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws?status=${localStorage.getItem('spk:status') ?? ''}`)
  ws = current
  heard = Date.now()
  // Also bounds a connection attempt that never opens or closes.
  armHeartbeat()
  current.onopen = () => {
    if (ws !== current) return
    retry = 0
    heard = Date.now()
    armHeartbeat()
    connected.value = true
    openHandlers.forEach(h => h())
  }
  current.onmessage = e => {
    if (ws !== current) return
    heard = Date.now()
    armHeartbeat()
    try {
      const m = JSON.parse(e.data)
      if (m.type === 'ping') current.send('ping')
      handlers.forEach(h => h(m))
    } catch {
      /* ignore malformed frames */
    }
  }
  current.onclose = () => {
    if (ws !== current) return
    resetSocket()
    if (!offline.value) retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000))
  }
}

/** One shared WebSocket for the app (reconnects with backoff). Client only. */
export function useSocket() {
  if (import.meta.client && !started) {
    started = true
    offline.value = !navigator.onLine
    window.addEventListener('offline', () => {
      offline.value = true
      resetSocket()
    })
    window.addEventListener('online', () => {
      offline.value = false
      connect()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || offline.value) return
      if (ws && Date.now() - heard >= HEARTBEAT_MS) resetSocket()
      connect()
    })
    connect()
  }
  return {
    connected,
    offline,
    send: (data: unknown) => {
      if (ws?.readyState !== WebSocket.OPEN) return false
      ws.send(JSON.stringify(data))
      return true
    },
    /** Subscribe until explicitly removed or the calling component unmounts. */
    on(h: Handler) {
      handlers.add(h)
      const off = () => {
        handlers.delete(h)
      }
      if (getCurrentScope()) onScopeDispose(off)
      return off
    },
    onOpen(h: () => void) {
      openHandlers.add(h)
      onScopeDispose(() => openHandlers.delete(h))
    },
  }
}
