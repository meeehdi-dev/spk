import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

class MockSocket {
  static OPEN = 1
  readyState = 0
  onopen?: () => void
  onclose?: (event?: CloseEvent) => void
  onmessage?: (event: { data: string }) => void
  send = vi.fn()
  close = vi.fn()
  constructor(_url: string) {
    sockets.push(this)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
}
let sockets: MockSocket[]
let scope: ReturnType<typeof effectScope>
let windowEvents: Map<string, EventListener>
let documentEvents: Map<string, EventListener>

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  sockets = []
  scope = effectScope()
  windowEvents = new Map()
  documentEvents = new Map()
  vi.stubGlobal('WebSocket', MockSocket)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(window, 'addEventListener').mockImplementation((event, listener) => {
    windowEvents.set(event, listener as EventListener)
  })
  vi.spyOn(document, 'addEventListener').mockImplementation((event, listener) => {
    documentEvents.set(event, listener as EventListener)
  })
})
afterEach(() => {
  scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup() {
  const { useSocket } = await import('~/composables/useSocket')
  return scope.run(useSocket)!
}
function fire(target: Map<string, EventListener>, name: string) {
  target.get(name)!(new Event(name))
}

it('never expires an open socket for inactivity and ignores callbacks from replaced sockets', async () => {
  const socket = await setup()
  const first = sockets[0]!
  first.open()
  expect(socket.connected.value).toBe(true)
  await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
  first.onmessage?.({ data: '{"type":"ping"}' })
  expect(first.send).toHaveBeenCalledWith('ping')
  await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
  expect(sockets).toHaveLength(1)
  expect(first.close).not.toHaveBeenCalled()
  first.onclose?.()
  expect(socket.connected.value).toBe(false)
  await vi.advanceTimersByTimeAsync(1000)
  const second = sockets[1]!
  second.open()
  first.onclose?.()
  first.onopen?.()
  first.onmessage?.({ data: '{"type":"ping"}' })
  expect(socket.connected.value).toBe(true)
  expect(first.send).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(sockets).toHaveLength(2)
})

it('keeps a working socket through a brief offline blip without any outage', async () => {
  const socket = await setup()
  sockets[0]!.open()
  fire(windowEvents, 'offline')
  expect(socket.offline.value).toBe(true)
  await vi.advanceTimersByTimeAsync(4000)
  fire(windowEvents, 'online')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(sockets[0]!.close).not.toHaveBeenCalled()
  expect(socket.connected.value).toBe(true)
  expect(socket.lost.value).toBe(false)
})

it('drops after staying offline, retries promptly online and never duplicates a healthy socket', async () => {
  const socket = await setup()
  sockets[0]!.open()
  fire(windowEvents, 'offline')
  await vi.advanceTimersByTimeAsync(5000)
  expect(socket.connected.value).toBe(false)
  expect(socket.lost.value).toBe(true)
  sockets[0]!.onclose?.()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(sockets).toHaveLength(1)
  fire(windowEvents, 'online')
  expect(socket.offline.value).toBe(false)
  expect(sockets).toHaveLength(2)
  sockets[1]!.open()
  expect(socket.lost.value).toBe(false)
  fire(windowEvents, 'online')
  expect(sockets).toHaveLength(2)
})

it('marks lost only after 5 s down and reports the outage once reconnected', async () => {
  const socket = await setup()
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  sockets[0]!.open()
  sockets[0]!.onclose?.({ code: 1006, wasClean: false } as CloseEvent)
  await vi.advanceTimersByTimeAsync(1000)
  sockets[1]!.open()
  expect(socket.lost.value).toBe(false)
  const diag = (s: MockSocket) => s.send.mock.calls.map(([d]) => JSON.parse(d as string)).find(d => d.type === 'diag')
  expect(diag(sockets[1]!).events).toEqual([expect.objectContaining({ kind: 'app', cause: 'close', code: 1006, wasClean: false, lost: false })])
  sockets[1]!.onclose?.()
  await vi.advanceTimersByTimeAsync(4999)
  expect(socket.lost.value).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(socket.lost.value).toBe(true)
  await vi.advanceTimersByTimeAsync(2000)
  sockets[2]!.open()
  expect(socket.lost.value).toBe(false)
  expect(diag(sockets[2]!).events[0]).toMatchObject({ lost: true, outageMs: expect.any(Number) })
  expect(info).toHaveBeenCalledTimes(2)
})

it('keeps backoff but does not reset an open socket after waking the tab', async () => {
  await setup()
  sockets[0]!.open()
  sockets[0]!.onclose?.()
  await vi.advanceTimersByTimeAsync(999)
  expect(sockets).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(sockets).toHaveLength(2)
  sockets[1]!.open()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.setSystemTime(Date.now() + 120_000)
  fire(documentEvents, 'visibilitychange')
  expect(sockets[1]!.close).not.toHaveBeenCalled()
  expect(sockets).toHaveLength(2)
})

it('bounds a handshake that never opens without applying that timeout to an open socket', async () => {
  await setup()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(sockets[0]!.close).toHaveBeenCalledOnce()
  expect(sockets).toHaveLength(2)
  sockets[1]!.open()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(sockets[1]!.close).not.toHaveBeenCalled()
})
