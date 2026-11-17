import type { SocketFrame } from '~/utils/socket-browser'

import { computed, getCurrentScope, onScopeDispose } from 'vue'

import { onScenarioReset, sandboxSocketSend, scenario, subscribeSocket } from './fixtures'

export type { SocketFrame } from '~/utils/socket-browser'

const openHandlers = new Set<() => void>()
const connected = computed(() => scenario.value !== 'reconnecting')
const offline = computed(() => false)
onScenarioReset(() => {
  if (connected.value) openHandlers.forEach(h => h())
})

/** Same facade as the browser socket, with no network or reconnect timers. */
export function useSocket() {
  return {
    connected,
    offline,
    send: (data: unknown) => connected.value && sandboxSocketSend(data),
    on(handler: (frame: SocketFrame) => void) {
      const off = subscribeSocket(handler)
      if (getCurrentScope()) onScopeDispose(off)
      return off
    },
    onOpen(handler: () => void) {
      openHandlers.add(handler)
      if (getCurrentScope()) onScopeDispose(() => openHandlers.delete(handler))
    },
  }
}
