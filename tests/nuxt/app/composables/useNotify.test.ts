import type { SocketFrame } from '~/composables/useSocket'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { playBlip, useIncomingNotifications } from '~/composables/useNotify'

const mocks = vi.hoisted(() => ({
  status: { value: 'online' },
  toast: vi.fn(),
  on: vi.fn<(handler: (frame: SocketFrame) => Promise<void>) => void>(),
}))
mockNuxtImport('useMyStatus', () => () => mocks.status)
mockNuxtImport('useToast', () => () => ({ add: mocks.toast }))
mockNuxtImport('useSocket', () => () => ({ on: mocks.on }))
mockNuxtImport('useMe', () => () => ({ data: { value: { id: 'me' } } }))
mockNuxtImport('useChannels', () => () => ({ data: { value: [{ id: 'dm', type: 'dm' }] } }))
mockNuxtImport('useUsers', () => () => ({ nameOf: () => 'Friend' }))
mockNuxtImport('navigateTo', () => vi.fn())
mockNuxtImport('useRoute', () => () => ({ params: {} }))

const media = vi.hoisted(() => {
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  const oscillator = { frequency: { value: 0 }, connect: () => gain, start: vi.fn(), stop: vi.fn() }
  const context = { currentTime: 0, createOscillator: () => oscillator, createGain: () => gain }
  const play = vi.fn((callback: (audio: typeof context, destination: object) => void) => callback(context, {}))
  return { gain, context, destination: {}, play }
})
vi.mock('~/utils/media-audio', () => ({
  playMediaAudio: media.play,
}))

let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.status.value = 'online'
  scope = effectScope()
  media.play.mockImplementation(callback => callback(media.context, media.destination))
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('message sound output', () => {
  it('routes both notes through media output at the notification volume', () => {
    scope.run(() => playBlip(0.5))
    expect(media.gain.connect).toHaveBeenCalledTimes(2)
    expect(media.gain.connect).toHaveBeenCalledWith(media.destination)
    expect(media.gain.gain.setValueAtTime).toHaveBeenCalledWith(0.15, 0)
    expect(media.gain.gain.setValueAtTime).toHaveBeenCalledWith(0.15, 0.09)
  })

  it('silences Busy but allows an explicit preview', () => {
    mocks.status.value = 'busy'
    scope.run(() => playBlip(0.5))
    expect(media.play).not.toHaveBeenCalled()
    scope.run(() => playBlip(0.5, true))
    expect(media.gain.connect).toHaveBeenCalledTimes(2)
  })

  it('rechecks Busy after audio routing finishes', () => {
    media.play.mockImplementationOnce(() => {})
    scope.run(() => playBlip(0.5))
    mocks.status.value = 'busy'
    media.play.mock.calls[0]![0](media.context, media.destination)
    expect(media.gain.connect).not.toHaveBeenCalled()
  })
})

const message: SocketFrame = {
  type: 'message:new',
  message: {
    id: 'message',
    channelId: 'dm',
    userId: 'friend',
    body: 'Hello',
    createdAt: 0,
    editedAt: null,
    replyTo: null,
    attachments: [],
    reactions: [],
    previews: [],
    pinned: false,
    poll: null,
  },
}

describe('incoming notifications', () => {
  it.each([true, false])('blocks sound and visuals while Busy, including pending delivery (focused: %s)', async focused => {
    const notification = Object.assign(
      vi.fn(function () {}),
      { permission: 'granted' },
    )
    vi.stubGlobal('Notification', notification)
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        addEventListener() {}
        postMessage() {}
        close() {}
      },
    )
    vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
    scope.run(() => useIncomingNotifications())
    vi.useFakeTimers()
    const receive = mocks.on.mock.calls[0]![0]

    mocks.status.value = 'busy'
    await receive(message)
    expect(media.play).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(notification).not.toHaveBeenCalled()

    mocks.status.value = 'online'
    const pending = receive(message)
    mocks.status.value = 'busy'
    await vi.advanceTimersByTimeAsync(150)
    await pending
    expect(media.play).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(notification).not.toHaveBeenCalled()

    mocks.status.value = 'online'
    const next = receive(message)
    await vi.advanceTimersByTimeAsync(150)
    await next
    expect(media.play).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledTimes(focused ? 1 : 0)
    expect(notification).toHaveBeenCalledTimes(focused ? 0 : 1)
  })

  it('asks the desktop shell for attention and focus only on a system notification', async () => {
    const notification = Object.assign(
      vi.fn(function () {}),
      { permission: 'granted' },
    )
    const spkDesktop = { attention: vi.fn(), focus: vi.fn() }
    vi.stubGlobal('Notification', notification)
    vi.stubGlobal('spkDesktop', spkDesktop)
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        addEventListener() {}
        postMessage() {}
        close() {}
      },
    )
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    scope.run(() => useIncomingNotifications())
    vi.useFakeTimers()
    const receive = mocks.on.mock.calls[0]![0]

    const toast = receive(message)
    await vi.advanceTimersByTimeAsync(150)
    await toast
    expect(spkDesktop.attention).not.toHaveBeenCalled()

    hasFocus.mockReturnValue(false)
    const system = receive(message)
    await vi.advanceTimersByTimeAsync(150)
    await system
    expect(spkDesktop.attention).toHaveBeenCalledOnce()
    expect(spkDesktop.focus).not.toHaveBeenCalled()
    const instance = notification.mock.instances[0] as { onclick: () => void; close: () => void }
    instance.close = vi.fn()
    instance.onclick()
    expect(spkDesktop.focus).toHaveBeenCalledOnce()
  })
})
