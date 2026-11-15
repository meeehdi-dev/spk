import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import ConnectionNotice from '~/components/ConnectionNotice.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    socket: { connected: ref(true), offline: ref(false) },
    voice: {
      connection: ref('connected'),
      audioBlocked: ref(false),
      retryChannelId: ref<string | null>(null),
      channelId: ref<string | null>('voice'),
      connecting: ref(false),
      enableAudio: vi.fn(),
      reconnect: vi.fn(),
      leave: vi.fn(),
    },
    toast: vi.fn(),
  }
})
mockNuxtImport('useSocket', () => () => state.socket)
mockNuxtImport('useVoice', () => () => state.voice)
mockNuxtImport('useToast', () => () => ({ add: state.toast }))
beforeEach(() => {
  state.socket.connected.value = true
  state.socket.offline.value = false
  state.voice.connection.value = 'connected'
  state.voice.audioBlocked.value = false
  state.voice.retryChannelId.value = null
  state.voice.channelId.value = 'voice'
  vi.clearAllMocks()
})

it('announces app versus media interruptions and only notifies once per transition', async () => {
  const wrapper = await mountInApp(ConnectionNotice)
  expect(wrapper.get('[role="status"]').attributes('aria-live')).toBe('polite')
  expect(wrapper.text()).toBe('')
  expect(state.toast).not.toHaveBeenCalled()
  state.socket.connected.value = false
  await nextTick()
  expect(wrapper.text()).toContain('Voice may still work')
  state.socket.offline.value = true
  await nextTick()
  expect(wrapper.text()).toContain('Offline')
  expect(state.toast).toHaveBeenCalledTimes(1)
  state.voice.connection.value = 'reconnecting'
  await nextTick()
  expect(wrapper.text()).toContain('Voice interrupted')
  expect(wrapper.text()).toContain('Leave voice')
  state.socket.connected.value = true
  state.socket.offline.value = false
  await nextTick()
  expect(state.toast).toHaveBeenCalledTimes(2)
})

it('offers click-to-enable playback and an explicit terminal rejoin', async () => {
  const wrapper = await mountInApp(ConnectionNotice)
  state.voice.audioBlocked.value = true
  await nextTick()
  const button = (label: string) => wrapper.findAll('button').find(b => b.text() === label)!
  await button('Enable audio').trigger('click')
  expect(state.voice.enableAudio).toHaveBeenCalledOnce()
  state.voice.audioBlocked.value = false
  state.voice.connection.value = 'disconnected'
  state.voice.channelId.value = null
  state.voice.retryChannelId.value = 'voice'
  state.socket.connected.value = false
  await nextTick()
  expect(button('Rejoin voice').attributes('disabled')).toBeDefined()
  state.socket.connected.value = true
  await nextTick()
  await button('Rejoin voice').trigger('click')
  expect(state.voice.reconnect).toHaveBeenCalledOnce()
  await button('Dismiss').trigger('click')
  expect(state.voice.leave).toHaveBeenCalledWith(false)
})
