import type { SocketFrame } from '../app/composables/useSocket'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, onScopeDispose, ref, watch } from 'vue'

let directory: typeof import('../app/composables/useRadioDirectory')
let scope: ReturnType<typeof effectScope>
let receive: (frame: SocketFrame) => void
const connected = ref(true)
const stations = ref({})
const first = { channelId: 'a', station: { id: 'one', name: 'One' } }
const second = { channelId: 'b', station: { id: 'two', name: 'Two' } }

beforeEach(async () => {
  vi.resetModules()
  stations.value = {}
  connected.value = true
  vi.stubGlobal('useState', () => stations)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onScopeDispose', onScopeDispose)
  vi.stubGlobal('useSocket', () => ({
    connected,
    on: (handler: typeof receive) => {
      receive = handler
    },
  }))
  directory = await import('../app/composables/useRadioDirectory')
  scope = effectScope()
  scope.run(() => directory.useRadioDirectoryLive())
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('radio directory client', () => {
  it('shows multiple channels from a late-connection snapshot and applies replacement and stop updates', () => {
    receive({ type: 'radio:snapshot', channels: [first, second] })
    expect(directory.useRadioDirectory().value).toEqual({ a: first.station, b: second.station })
    receive({ type: 'radio:update', channelId: 'a', station: second.station })
    receive({ type: 'radio:update', channelId: 'b', station: null })
    expect(directory.useRadioDirectory().value).toEqual({ a: second.station })
  })

  it('hides on disconnect, ignores disconnected messages, and replaces stale state on reconnect', () => {
    receive({ type: 'radio:snapshot', channels: [first] })
    connected.value = false
    expect(stations.value).toEqual({})
    receive({ type: 'radio:update', ...second })
    expect(stations.value).toEqual({})
    connected.value = true
    expect(stations.value).toEqual({})
    receive({ type: 'radio:snapshot', channels: [second] })
    expect(stations.value).toEqual({ b: second.station })
    receive({ type: 'radio:snapshot', channels: [] })
    expect(stations.value).toEqual({})
  })
})
