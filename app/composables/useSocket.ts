type Handler = (msg: any) => void
const handlers = new Set<Handler>()
const openHandlers = new Set<() => void>()
let ws: WebSocket | undefined
let retry = 0
const connected = ref(false)

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws`)
  ws.onopen = () => { retry = 0; connected.value = true; openHandlers.forEach(h => h()) }
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data)
      if (m.type === 'ping') ws?.send('ping') // keeps the server's dead-socket check satisfied
      handlers.forEach(h => h(m))
    } catch { /* ignore malformed frames */ }
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
    send: (data: unknown) => { if (ws?.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(data)); return true },
    /** Subscribe until the calling component unmounts. */
    on(h: Handler) { handlers.add(h); onScopeDispose(() => handlers.delete(h)) },
    onOpen(h: () => void) { openHandlers.add(h); onScopeDispose(() => openHandlers.delete(h)) }
  }
}
