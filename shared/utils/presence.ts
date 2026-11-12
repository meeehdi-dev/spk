export type Presence = 'online' | 'idle' | 'busy' | 'offline'
/** What a user picks: offline = invisible. */
export const MANUAL_STATUSES = ['online', 'away', 'busy', 'offline'] as const
export type ManualStatus = (typeof MANUAL_STATUSES)[number]

/**
 * One state per open socket (true = idle). Online if any tab is active, idle if all are idle, offline with no socket.
 * A manual status overrides it: offline/busy win, away shows as idle.
 */
export function reducePresence(idleBySocket: Iterable<boolean>, manual?: ManualStatus): Presence {
  let any = false
  let active = false
  for (const idle of idleBySocket) {
    any = true
    if (!idle) active = true
  }
  if (!any || manual === 'offline') return 'offline'
  if (manual === 'busy') return 'busy'
  if (manual === 'away') return 'idle'
  return active ? 'online' : 'idle'
}
