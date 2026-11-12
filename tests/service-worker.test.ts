import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('service-worker/sw.js', 'utf8')

function worker() {
  const listeners = new Map<string, (event: unknown) => void>()
  const matchAll = vi.fn().mockResolvedValue([])
  const openWindow = vi.fn().mockResolvedValue({})
  const showNotification = vi.fn().mockResolvedValue(undefined)
  runInNewContext(source, {
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler),
      clients: { matchAll, openWindow },
      registration: { showNotification },
    },
  })
  return {
    listeners,
    matchAll,
    openWindow,
    showNotification,
    async dispatch(name: string, event: Record<string, unknown>) {
      let completion: Promise<unknown> | undefined
      listeners.get(name)!({ ...event, waitUntil: (promise: Promise<unknown>) => (completion = promise) })
      await completion
    },
  }
}

describe('push-only worker', () => {
  it('keeps fetches outside the worker and ignores malformed push payloads', async () => {
    const w = worker()
    expect([...w.listeners.keys()]).toEqual(['install', 'activate', 'push', 'notificationclick'])
    await w.dispatch('push', {})
    await w.dispatch('push', { data: { json: () => JSON.parse('invalid') } })
    expect(w.showNotification).not.toHaveBeenCalled()
  })

  it('uses generated icons and suppresses push while an app window is focused', async () => {
    const w = worker()
    const payload = { title: 'Friend', body: 'Hello', tag: 'channel', url: '/c/channel/m/message' }
    const event = { data: { json: () => payload } }
    await w.dispatch('push', event)
    expect(w.showNotification).toHaveBeenCalledExactlyOnceWith('Friend', {
      body: 'Hello',
      tag: 'channel',
      data: { url: payload.url },
      icon: '/pwa-192x192.png',
      badge: '/badge.png',
    })
    w.matchAll.mockResolvedValue([{ focused: true }])
    await w.dispatch('push', event)
    expect(w.showNotification).toHaveBeenCalledOnce()
  })

  it('focuses an existing app window and sends the message destination without reloading', async () => {
    const w = worker()
    const focus = vi.fn().mockResolvedValue(undefined)
    const postMessage = vi.fn()
    const close = vi.fn()
    w.matchAll.mockResolvedValue([{ focus, postMessage }])
    await w.dispatch('notificationclick', { notification: { close, data: { url: '/c/channel/m/message' } } })
    expect(close).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'navigate', url: '/c/channel/m/message' })
    expect(w.openWindow).not.toHaveBeenCalled()
  })

  it('opens the message destination when no window exists, falling back to the root', async () => {
    const w = worker()
    const close = vi.fn()
    await w.dispatch('notificationclick', { notification: { close, data: { url: '/c/channel/m/message' } } })
    expect(w.openWindow).toHaveBeenLastCalledWith('/c/channel/m/message')
    await w.dispatch('notificationclick', { notification: { close } })
    expect(w.openWindow).toHaveBeenLastCalledWith('/')
  })
})
