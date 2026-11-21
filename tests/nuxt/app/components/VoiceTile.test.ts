import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import VoiceTile from '~/components/VoiceTile.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const voice = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { channelId: ref('voice'), playing: ref({}), volumes: ref({}), watch: vi.fn() }
})
const members = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return ref([{ userId: 'remote', muted: false, deafened: false }])
})
mockNuxtImport('voiceMembers', () => () => members.value)
const fullscreen = vi.hoisted(() => ({ toggle: vi.fn(), exit: vi.fn() }))
mockNuxtImport('useFullscreen', () => () => fullscreen)
mockNuxtImport('useVoice', () => () => voice)
mockNuxtImport('useAdmin', () => () => ({ userGroups: () => [] }))

const ECO = { height: 1440, fps: 5 } as const
const remoteName = 'Remote with a very long display name'

beforeAll(() => {
  registerEndpoint('/api/users', () => [{ id: 'remote', displayName: remoteName, avatarKey: null, role: 'user' }])
})

beforeEach(() => {
  vi.clearAllMocks()
  members.value = [{ userId: 'remote', muted: false, deafened: false }]
})

it('updates mute and deafen icons beside the name, with deafen taking priority', async () => {
  const tile = reactive({ userId: 'remote', local: false, watching: false, screenLive: false, camLive: false })
  const wrapper = await mountInApp(VoiceTile, { tile, theater: false })
  const muted = () => wrapper.find('[aria-label="Muted"]')
  const deafened = () => wrapper.find('[aria-label="Deafened"]')

  expect(muted().exists()).toBe(false)
  expect(deafened().exists()).toBe(false)
  members.value[0]!.muted = true
  await nextTick()
  expect(muted().classes()).toContain('i-lucide:mic-off')
  members.value[0]!.deafened = true
  await nextTick()
  expect(muted().exists()).toBe(false)
  expect(deafened().classes()).toContain('i-lucide:headphone-off')
  members.value[0]!.muted = false
  members.value[0]!.deafened = false
  await nextTick()
  expect(muted().exists()).toBe(false)
  expect(deafened().exists()).toBe(false)
})

describe('screen controls', () => {
  it('exits fullscreen on unwatch or loss of all live video, but not while the camera remains live', async () => {
    const tile = reactive({ userId: 'remote', local: false, watching: true, screenLive: true, camLive: true })
    await mountInApp(VoiceTile, { tile, theater: false })
    tile.screenLive = false
    await nextTick()
    expect(fullscreen.exit).not.toHaveBeenCalled()
    tile.camLive = false
    await nextTick()
    expect(fullscreen.exit).toHaveBeenCalledTimes(1)
    expect(tile.watching).toBe(true)
    tile.screenLive = true
    await nextTick()
    expect(fullscreen.toggle).not.toHaveBeenCalled()
    tile.watching = false
    await nextTick()
    expect(fullscreen.exit).toHaveBeenCalledTimes(2)
  })

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
    expect(quality()!.nextElementSibling).toBeNull() // no LIVE badge
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
