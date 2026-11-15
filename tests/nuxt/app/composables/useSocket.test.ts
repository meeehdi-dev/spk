import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

class MockSocket {
  static OPEN = 1
  readyState = 0
  onopen?: () => void
  onclose?: () => void
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

it('reconnects silently dead sockets and ignores callbacks from their replacements', async () => {
  const socket = await setup()
  const first = sockets[0]!
  first.open()
  expect(socket.connected.value).toBe(true)
  await vi.advanceTimersByTimeAsync(40_000)
  first.onmessage?.({ data: '{"type":"ping"}' })
  expect(first.send).toHaveBeenCalledWith('ping')
  await vi.advanceTimersByTimeAsync(59_999)
  expect(sockets).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(first.close).toHaveBeenCalledOnce()
  expect(socket.connected.value).toBe(false)
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

it('waits offline, retries promptly online and never duplicates a healthy socket', async () => {
  const socket = await setup()
  sockets[0]!.open()
  fire(windowEvents, 'offline')
  expect(socket.offline.value).toBe(true)
  expect(socket.connected.value).toBe(false)
  sockets[0]!.onclose?.()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(sockets).toHaveLength(1)
  fire(windowEvents, 'online')
  expect(socket.offline.value).toBe(false)
  expect(sockets).toHaveLength(2)
  sockets[1]!.open()
  fire(windowEvents, 'online')
  expect(sockets).toHaveLength(2)
})

it('keeps backoff and rechecks an expired connection after waking the tab', async () => {
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
  expect(sockets[1]!.close).toHaveBeenCalledOnce()
  expect(sockets).toHaveLength(3)
})
