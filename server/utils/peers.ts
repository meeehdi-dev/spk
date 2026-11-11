import type { Peer } from 'crossws'

import { reducePresence, type Presence } from '../../shared/utils/presence'

// userId -> open sockets. Later features (messages, presence, voice) broadcast through this.
const peers = new Map<string, Set<Peer>>()

export function addPeer(userId: string, peer: Peer) {
  const before = presenceOf(userId)
  if (!peers.has(userId)) peers.set(userId, new Set())
  peers.get(userId)!.add(peer)
  return presenceOf(userId) === before ? null : presenceOf(userId)
}

export function removePeer(userId: string, peer: Peer) {
  const set = peers.get(userId)
  const before = presenceOf(userId)
  set?.delete(peer)
  if (set?.size === 0) peers.delete(userId)
  return presenceOf(userId) === before ? null : presenceOf(userId)
}

const idlePeers = new WeakSet<Peer>()

export const presenceOf = (userId: string): Presence => reducePresence([...peersOf(userId)].map(p => idlePeers.has(p)))
export const presenceSnapshot = () => Object.fromEntries([...peers.keys()].map(id => [id, presenceOf(id)]))

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
