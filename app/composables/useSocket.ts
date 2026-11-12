import type { Presence } from '#shared/utils/presence'

import type { MessageDto } from '../../server/db/messages'
import type { VoicePresence } from '../../server/utils/voicePresence'

export type SocketFrame =
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
let retry = 0
const connected = ref(false)

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws?status=${localStorage.getItem('spk:status') ?? ''}`) // the server applies it before announcing presence
  ws.onopen = () => {
    retry = 0
    connected.value = true
    openHandlers.forEach(h => h())
  }
  ws.onmessage = e => {
    try {
      const m = JSON.parse(e.data)
      if (m.type === 'ping') ws?.send('ping') // keeps the server's dead-socket check satisfied
      handlers.forEach(h => h(m))
    } catch {
      /* ignore malformed frames */
    }
  }
  ws.onclose = () => {
    connected.value = false
    setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000))
  }
}

/** One shared WebSocket for the app (reconnects with backoff). Client only. */
export function useSocket() {
  if (import.meta.client && !ws) connect()
  return {
    connected,
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
