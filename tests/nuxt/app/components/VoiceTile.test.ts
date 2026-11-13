import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import VoiceTile from '~/components/VoiceTile.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const voice = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { playing: ref({}), volumes: ref({}), watch: vi.fn() }
})
mockNuxtImport('useVoice', () => () => voice)
mockNuxtImport('useAdmin', () => () => ({ userGroups: () => [] }))

const ECO = { height: 1440, fps: 5 } as const
const remoteName = 'Remote with a very long display name'

beforeAll(() => {
  registerEndpoint('/api/users', () => [{ id: 'remote', displayName: remoteName, avatarKey: null, role: 'user' }])
})

describe('screen controls', () => {
  it('renders the preset beside the name without playback and keeps Stop watching available between streams', async () => {
    const tile = reactive({ userId: 'remote', local: false, watching: true, screenLive: true, screenAudio: true, screenQuality: ECO as typeof ECO | undefined })
    const wrapper = await mountInApp(VoiceTile, reactive({ tile, theater: false }))
    await flushPromises()
    const quality = () => wrapper.find('span.border-l').element as HTMLElement | undefined
    const stopWatching = () => wrapper.find('button[aria-label="Stop watching"]')

    expect(stopWatching().exists()).toBe(true)
    await stopWatching().trigger('click')
    expect(voice.watch).toHaveBeenCalledExactlyOnceWith('remote', false)
    expect(quality()!.textContent?.trim()).toBe('1440p · 5 fps')
    expect(quality()!.previousElementSibling?.textContent).toBe(remoteName)
    expect(quality()!.previousElementSibling?.classList.contains('truncate')).toBe(true)
    expect(quality()!.parentElement?.classList.contains('top-2')).toBe(true)
    expect(quality()!.classList.contains('whitespace-nowrap')).toBe(true)
    expect(wrapper.find('span.bottom-12').exists()).toBe(false)
    tile.watching = false
    await nextTick()
    expect(quality()!.nextElementSibling?.textContent?.trim()).toBe('LIVE')
    tile.watching = true
    tile.local = true // hidden local preview still has the preset
    await nextTick()
    expect(quality()!.previousElementSibling?.textContent).toBe('You')
    tile.screenLive = false // camera-only/stopped tile cannot display stale quality
    tile.local = false
    await nextTick()
    expect(wrapper.find('span.border-l').exists()).toBe(false)
    await stopWatching().trigger('click')
    expect(voice.watch).toHaveBeenCalledTimes(2)
    tile.screenLive = true
    tile.screenQuality = undefined
    await nextTick()
    expect(wrapper.find('span.border-l').exists()).toBe(false)
  })
})
