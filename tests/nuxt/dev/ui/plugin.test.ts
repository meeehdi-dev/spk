import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { authClient } from '~~/dev/ui/auth'
import { resetScenario, responseDelay } from '~~/dev/ui/fixtures'
import { installSandboxTransport } from '~~/dev/ui/plugin'

let restore: (() => void) | undefined
beforeEach(() => resetScenario())
afterEach(() => {
  restore?.()
  restore = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('serves global ofetch, native session requests, and the local auth client without reaching the network', async () => {
  const network = vi.fn().mockRejectedValue(new Error('Network should not be used'))
  vi.stubGlobal('fetch', network)
  restore = installSandboxTransport()
  expect(await globalThis.$fetch<unknown>('/api/profile/me')).toMatchObject({ id: 'ui-me' })
  const apiFetch = globalThis.$fetch.create({ baseURL: '/api' }) as (path: string) => Promise<unknown>
  expect(await apiFetch('/channels')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'ui-general' })]))
  expect(globalThis.fetch).not.toBe(network)
  expect(fetch).toBe(globalThis.fetch)
  expect(window.fetch).toBe(globalThis.fetch)
  const session = await fetch('/api/auth/get-session').then(r => r.json())
  expect(session).toMatchObject({ user: { id: 'ui-me' }, session: { id: 'ui-session' } })
  expect(await authClient.getSession()).toMatchObject({ data: { user: { id: 'ui-me' } }, error: null })
  expect(await fetch(new Request('http://localhost/api/channels/ui-unread/read', { method: 'POST', body: '{}' })).then(r => r.json())).toEqual({
    unread: 0,
    mentions: 0,
  })
  expect(network).not.toHaveBeenCalled()
})

it('delays local responses for loading-state inspection without making network requests', async () => {
  vi.useFakeTimers()
  const network = vi.fn()
  vi.stubGlobal('fetch', network)
  restore = installSandboxTransport()
  responseDelay.value = 1000
  const done = vi.fn()
  const pending = fetch('/api/channels').then(done)
  await vi.advanceTimersByTimeAsync(999)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await pending
  expect(done).toHaveBeenCalledOnce()
  expect(network).not.toHaveBeenCalled()
})

it('fails closed on unknown API reads, all unsupported mutations, malformed bodies, and simulated errors', async () => {
  const network = vi.fn().mockResolvedValue(new Response('asset'))
  vi.stubGlobal('fetch', network)
  restore = installSandboxTransport()
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    expect((await fetch('/api/not-a-fixture', { method })).status).toBe(501)
  }
  expect((await fetch('https://example.test/api/profile/avatar', { method: 'POST' })).status).toBe(501)
  expect((await fetch('https://example.test/upload', { method: 'PUT', body: 'private' })).status).toBe(501)
  expect((await fetch('/api/profile/nickname', { method: 'POST', body: '{invalid' })).status).toBe(400)
  await expect(globalThis.$fetch<unknown>('/api/auth/change-password', { method: 'POST', body: {} })).rejects.toMatchObject({ statusCode: 501 })
  resetScenario('errors')
  await expect(globalThis.$fetch<unknown>('/api/channels/ui-general/messages')).rejects.toMatchObject({ statusCode: 503 })
  expect(network).not.toHaveBeenCalled()
  expect(await fetch('/_nuxt/module.js').then(r => r.text())).toBe('asset')
  expect(network).toHaveBeenCalledOnce()
})
