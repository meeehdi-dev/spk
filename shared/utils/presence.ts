export type Presence = 'online' | 'idle' | 'offline'

/** One state per open socket (true = idle). Online if any tab is active, idle if all are idle, offline with no socket. */
export function reducePresence(idleBySocket: Iterable<boolean>): Presence {
  let any = false
  for (const idle of idleBySocket) {
    if (!idle)
      return 'online'
    any = true
  }
  return any ? 'idle' : 'offline'
}
