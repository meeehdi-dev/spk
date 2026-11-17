import { beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { dispatchSocketFrame, resetScenario } from '~~/dev/ui/fixtures'
import { useSocket } from '~~/dev/ui/socket'

beforeEach(() => resetScenario())

it('dispatches frames, unsubscribes scoped listeners, and never opens a WebSocket', () => {
  const network = vi.spyOn(globalThis, 'WebSocket')
  const handler = vi.fn()
  const scope = effectScope()
  const socket = scope.run(() => {
    const s = useSocket()
    s.on(handler)
    return s
  })!
  socket.send({ type: 'typing', channelId: 'ui-general' })
  expect(handler).toHaveBeenLastCalledWith({ type: 'typing', channelId: 'ui-general', userId: 'ui-me' })
  dispatchSocketFrame({ type: 'typing', channelId: 'ui-general', userId: 'ui-alex' })
  expect(handler).toHaveBeenLastCalledWith({ type: 'typing', channelId: 'ui-general', userId: 'ui-alex' })
  scope.stop()
  handler.mockClear()
  dispatchSocketFrame({ type: 'users:changed' })
  expect(handler).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
  network.mockRestore()
})

it('exposes reconnecting state and invokes open listeners after a reset to connected', () => {
  const scope = effectScope()
  const opened = vi.fn()
  const socket = scope.run(() => {
    const s = useSocket()
    s.onOpen(opened)
    return s
  })!
  resetScenario('reconnecting')
  expect(socket.connected.value).toBe(false)
  expect(socket.offline.value).toBe(false)
  expect(socket.send({ type: 'message:send', body: 'No connection', channelId: 'ui-general' })).toBe(false)
  expect(opened).not.toHaveBeenCalled()
  resetScenario('populated')
  expect(socket.connected.value).toBe(true)
  expect(opened).toHaveBeenCalledOnce()
  scope.stop()
  resetScenario('empty')
  expect(opened).toHaveBeenCalledOnce()
})
