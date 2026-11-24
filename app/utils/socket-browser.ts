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
  | { type: 'sound:new'; id: string }
  | { type: 'presence:update'; userId: string; status: Presence }
  | { type: 'unread:update'; channelId: string; unread: number; mentions: number }
  | { type: 'message:new'; message: MessageDto; nonce?: string }
  | { type: 'message:error'; nonce?: string; error: string }
  | { type: 'message:edit'; message: MessageDto }
  | { type: 'message:delete'; channelId: string; id: string }
  | { type: 'message:previews'; channelId: string; messageId: string; previews: MessageDto['previews'] }
  | { type: 'poll:update'; channelId: string; messageId: string; poll: MessageDto['poll'] }
  | { type: 'reaction:update'; channelId: string; messageId: string; reactions: MessageDto['reactions'] }
  | { type: 'pin:update'; channelId: string; messageId: string; pinned: boolean }
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
let connectTimer: ReturnType<typeof setTimeout> | undefined
const connected = ref(false)
const offline = ref(false)
/** True once the app socket has been down for LOST_MS; brief drops never set it. */
const lost = ref(false)
export const LOST_MS = 5000
let lostTimer: ReturnType<typeof setTimeout> | undefined
let offlineTimer: ReturnType<typeof setTimeout> | undefined

// Outage diagnostics: queued while disconnected, sent on the next open so the server logs why connections drop.
export type OutageKind = 'app' | 'voice' | 'voiceSignal' | 'voiceTrack'
export type OutageStart = { at: number; hidden: boolean; online: boolean; visibleMs: number | null }
type OutageEnd = { kind: OutageKind; cause: string; code?: number; wasClean?: boolean; lost: boolean; track?: string }
let diagQueue: (OutageEnd & Omit<OutageStart, 'at'> & { outageMs: number; stallMs: number })[] = []
let stall: { at: number; ms: number } | undefined
let visibleSince = 0
let appDown: (OutageStart & { cause: string; code?: number; wasClean?: boolean }) | undefined

// visibleMs: how long the tab had been visible when the drop was noticed; a small value means it was found on wake.
export const outageStart = (): OutageStart => {
  const hidden = document.visibilityState === 'hidden'
  return { at: Date.now(), hidden, online: navigator.onLine, visibleMs: hidden ? null : Date.now() - visibleSince }
}
export function report({ at, ...start }: OutageStart, end: OutageEnd) {
  // stallMs: a long timer gap near the outage means the machine slept or the tab was frozen.
  const event = { ...end, ...start, outageMs: Date.now() - at, stallMs: stall && stall.at >= at - 60_000 ? stall.ms : 0 }
  console.info('[spk] connection outage', event)
  diagQueue = [...diagQueue, event].slice(-20)
  flushDiag()
}
function flushDiag() {
  if (!diagQueue.length || ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'diag', events: diagQueue }))
  diagQueue = []
}
/** Marks an open socket as dropping; `lost` follows after `delay` unless it reopens first. */
function down(cause: string, code?: number, wasClean?: boolean, delay = LOST_MS) {
  if (!connected.value) return
  appDown = { ...outageStart(), cause, code, wasClean }
  clearTimeout(lostTimer)
  if (delay) lostTimer = setTimeout(() => (lost.value = true), delay)
  else lost.value = true
}

function resetSocket() {
  clearTimeout(retryTimer)
  retryTimer = undefined
  clearTimeout(connectTimer)
  const old = ws
  ws = undefined // callbacks from an old socket must not affect its replacement
  connected.value = false
  old?.close()
}

function connect() {
  if (offline.value || ws) return
  clearTimeout(retryTimer)
  retryTimer = undefined
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws?status=${localStorage.getItem('spk:status') ?? ''}`)
  ws = current
  // Bound the handshake only; an open socket never expires because its tab is idle.
  connectTimer = setTimeout(() => {
    if (ws !== current) return
    resetSocket()
    connect()
  }, 60_000)
  current.onopen = () => {
    if (ws !== current) return
    retry = 0
    clearTimeout(connectTimer)
    clearTimeout(lostTimer)
    if (appDown) report(appDown, { kind: 'app', cause: appDown.cause, code: appDown.code, wasClean: appDown.wasClean, lost: lost.value })
    appDown = undefined
    lost.value = false
    connected.value = true
    flushDiag()
    openHandlers.forEach(h => h())
  }
  current.onmessage = e => {
    if (ws !== current) return
    try {
      const m = JSON.parse(e.data)
      if (m.type === 'ping') current.send('ping')
      handlers.forEach(h => h(m))
    } catch {
      /* ignore malformed frames */
    }
  }
  current.onclose = (e?: CloseEvent) => {
    if (ws !== current) return
    down('close', e?.code, e?.wasClean)
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
      clearTimeout(offlineTimer)
      // Brief offline flips (Wi-Fi roam, VPN, interface switch) often leave the socket working; drop it only if the network stays gone.
      offlineTimer = setTimeout(() => {
        down('offline', undefined, undefined, 0)
        resetSocket()
      }, LOST_MS)
    })
    window.addEventListener('online', () => {
      clearTimeout(offlineTimer)
      offline.value = false
      connect()
    })
    let tick = Date.now()
    setInterval(() => {
      const now = Date.now()
      if (now - tick > 15_000) stall = { at: now, ms: now - tick }
      tick = now
    }, 5000)
    visibleSince = Date.now()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') visibleSince = Date.now()
      if (document.visibilityState !== 'visible' || offline.value) return
      connect()
    })
    connect()
  }
  return {
    connected,
    offline,
    lost,
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
