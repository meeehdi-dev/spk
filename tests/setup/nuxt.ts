import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach } from 'vitest'

// The Nuxt app is shared by every test in a file, so components left mounted keep reacting to shared state.
enableAutoUnmount(afterEach)

// The real useSocket must never dial the test server; a socket that never opens or closes schedules no reconnects.
// Assigned directly rather than stubbed so tests calling vi.unstubAllGlobals() keep it.
globalThis.WebSocket = class {
  static readonly OPEN = 1
  readyState = 0
  send() {}
  close() {}
} as unknown as typeof WebSocket
