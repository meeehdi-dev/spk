import type { Peer } from 'crossws'

import { reducePresence, type ManualStatus, type Presence } from '../../shared/utils/presence'

// userId -> open sockets. Later features (messages, presence, voice) broadcast through this.
const peers = new Map<string, Set<Peer>>()

/** `status` is the manual status the client connected with, applied first so invisible/busy never flash as online. */
export function addPeer(userId: string, peer: Peer, status?: ManualStatus) {
  const before = presenceOf(userId)
  if (status) manualStatus.set(userId, status)
  if (!peers.has(userId)) peers.set(userId, new Set())
  peers.get(userId)!.add(peer)
  return presenceOf(userId) === before ? null : presenceOf(userId)
}

export function removePeer(userId: string, peer: Peer) {
  const set = peers.get(userId)
  const before = presenceOf(userId)
  set?.delete(peer)
  if (set?.size === 0) {
    peers.delete(userId)
    manualStatus.delete(userId)
  }
  return presenceOf(userId) === before ? null : presenceOf(userId)
}

const idlePeers = new WeakSet<Peer>()
// userId -> manual status; kept only while the user has an open socket.
const manualStatus = new Map<string, ManualStatus>()

export const presenceOf = (userId: string): Presence =>
  reducePresence(
    [...peersOf(userId)].map(p => idlePeers.has(p)),
    manualStatus.get(userId),
  )
/** Invisible users are absent (= offline). */
export const presenceSnapshot = () =>
  Object.fromEntries([...peers.keys()].map(id => [id, presenceOf(id)] as const).filter(([, status]) => status !== 'offline'))

/** The user picked a status; returns the new overall presence if it changed. */
export function setManualStatus(userId: string, status: ManualStatus) {
  const before = presenceOf(userId)
  manualStatus.set(userId, status)
  const after = presenceOf(userId)
  return after === before ? null : after
}

/** A tab reports idle/active; returns the user's new overall presence if it changed. */
export function setPeerIdle(userId: string, peer: Peer, idle: boolean) {
  const before = presenceOf(userId)
  if (idle) idlePeers.add(peer)
  else idlePeers.delete(peer)
  const after = presenceOf(userId)
  return after === before ? null : after
}

export const peersOf = (userId: string) => peers.get(userId) ?? new Set<Peer>()
export const onlineUserIds = () => [...peers.keys()]

export function sendToUser(userId: string, data: unknown) {
  const msg = JSON.stringify(data)
  for (const p of peersOf(userId)) p.send(msg)
}

export function broadcast(data: unknown) {
  for (const id of peers.keys()) sendToUser(id, data)
}
