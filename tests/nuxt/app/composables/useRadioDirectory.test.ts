import type { SocketFrame } from '~/composables/useSocket'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useRadioDirectory, useRadioDirectoryLive } from '~/composables/useRadioDirectory'

const socket = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { connected: ref(true), receive: (_frame: SocketFrame) => {} }
})
mockNuxtImport('useSocket', () => () => ({
  connected: socket.connected,
  on: (handler: (frame: SocketFrame) => void) => {
    socket.receive = handler
  },
}))

const first = { channelId: 'a', station: { id: 'one', name: 'One' } }
const second = { channelId: 'b', station: { id: 'two', name: 'Two' } }
let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  socket.connected.value = true
  scope = effectScope()
  scope.run(useRadioDirectoryLive)
})
afterEach(() => scope.stop())

describe('radio directory client', () => {
  it('shows multiple channels from a late-connection snapshot and applies replacement and stop updates', () => {
    socket.receive({ type: 'radio:snapshot', channels: [first, second] })
    expect(useRadioDirectory().value).toEqual({ a: first.station, b: second.station })
    socket.receive({ type: 'radio:update', channelId: 'a', station: second.station })
    socket.receive({ type: 'radio:update', channelId: 'b', station: null })
    expect(useRadioDirectory().value).toEqual({ a: second.station })
  })

  it('hides on disconnect, ignores disconnected messages, and replaces stale state on reconnect', () => {
    const stations = useRadioDirectory()
    socket.receive({ type: 'radio:snapshot', channels: [first] })
    socket.connected.value = false
    expect(stations.value).toEqual({})
    socket.receive({ type: 'radio:update', ...second })
    expect(stations.value).toEqual({})
    socket.connected.value = true
    expect(stations.value).toEqual({})
    socket.receive({ type: 'radio:snapshot', channels: [second] })
    expect(stations.value).toEqual({ b: second.station })
    socket.receive({ type: 'radio:snapshot', channels: [] })
    expect(stations.value).toEqual({})
  })
})
