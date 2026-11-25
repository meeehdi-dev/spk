import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import setup from '~/plugins/desktop.client'

const voice = vi.hoisted(() => ({
  channelId: { value: null as string | null },
  mute: { value: { muted: false, deafened: false, restore: false } },
  camOn: { value: false },
  screenOn: { value: false },
  toggleMic: vi.fn(),
  toggleHeadphones: vi.fn(),
  toggleCamera: vi.fn(),
  toggleScreen: vi.fn(),
  leave: vi.fn(),
  holdToTalk: vi.fn(),
}))
const tab = vi.hoisted(() => ({ value: null as string | null }))
mockNuxtImport('useVoice', () => () => voice)
mockNuxtImport('useSettingsModal', () => () => tab)

const run = () => (setup as unknown as () => void)()

beforeEach(() => {
  vi.clearAllMocks()
  tab.value = null
})
afterEach(() => {
  Reflect.deleteProperty(window, 'spkDesktop')
})

describe('desktop bridge', () => {
  it('does nothing in a browser or without voiceState', () => {
    run()
    window.spkDesktop = { onCommand: vi.fn() }
    run()
    expect(window.spkDesktop.onCommand).not.toHaveBeenCalled()
  })

  it('reports voice state and runs shell commands', async () => {
    const reactive = { channelId: ref<string | null>(null), mute: ref({ muted: false, deafened: false, restore: false }) }
    voice.channelId = reactive.channelId as never
    voice.mute = reactive.mute as never
    const voiceState = vi.fn()
    let onCommand!: (cmd: string) => void
    window.spkDesktop = { voiceState, onCommand: cb => ((onCommand = cb), () => {}) }
    run()
    expect(voiceState).toHaveBeenLastCalledWith({ inCall: false, muted: false, deafened: false, camOn: false, screenOn: false })
    reactive.channelId.value = 'c'
    reactive.mute.value = { muted: true, deafened: false, restore: false }
    await nextTick()
    expect(voiceState).toHaveBeenLastCalledWith({ inCall: true, muted: true, deafened: false, camOn: false, screenOn: false })

    for (const [cmd, fn] of [
      ['toggle-mic', voice.toggleMic],
      ['toggle-deafen', voice.toggleHeadphones],
      ['toggle-camera', voice.toggleCamera],
      ['toggle-screen', voice.toggleScreen],
      ['leave', voice.leave],
    ] as const) {
      onCommand(cmd)
      expect(fn).toHaveBeenCalledOnce()
    }
    onCommand('settings')
    expect(tab.value).toBe('profile')
    onCommand('ptt-down')
    onCommand('ptt-up')
    onCommand('bogus')
    expect(voice.holdToTalk.mock.calls).toEqual([[true], [false]])
  })
})
