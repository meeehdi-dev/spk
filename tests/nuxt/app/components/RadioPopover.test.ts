import type { RadioFavorite } from '#shared/utils/radio'

import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import RadioPopover from '~/components/RadioPopover.vue'
import { mountInApp, requestError } from '~~/tests/fixtures/app'

const playback = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    channelId: ref<string | null>('channel'),
    station: ref<{ id: string; name: string } | null>(null),
    enabled: ref(true),
    playback: ref('idle'),
    volume: ref(0.5),
    commandError: ref(''),
    listen: vi.fn(),
    mute: vi.fn(),
    stop: vi.fn(),
    select: vi.fn(),
  }
})
mockNuxtImport('useRadio', () => () => playback)
mockNuxtImport('useVoice', () => () => ({ channelId: playback.channelId, mute: { value: { deafened: false } } }))

interface State {
  open: boolean
  favoritesOnly: boolean
  favorites: RadioFavorite[]
  favoritesReady: boolean
  favoritesLoading: boolean
  favoritesError: string
  visibleStations: RadioFavorite[]
  q: string
  saving: string[]
  toggleFavorite: (station: RadioFavorite) => Promise<void>
}

const favorite = { id: 'station', name: 'Jazz', country: 'FR', codec: 'MP3', available: true }
const list = vi.fn()
const save = vi.fn()
const remove = vi.fn()

beforeAll(() => {
  registerEndpoint('/api/radio/favorites', () => list())
  registerEndpoint('/api/radio/favorites/station', { method: 'PUT', handler: () => save() })
  registerEndpoint('/api/radio/favorites/station', { method: 'DELETE', handler: () => remove() })
})
beforeEach(() => {
  for (const fn of [list, save, remove, playback.listen, playback.mute, playback.stop, playback.select]) fn.mockReset()
  playback.channelId.value = 'channel'
  playback.station.value = null
  playback.enabled.value = true
  playback.playback.value = 'idle'
  playback.listen.mockImplementation(() => {
    playback.enabled.value = true
  })
  playback.mute.mockImplementation(() => {
    playback.enabled.value = false
  })
  list.mockResolvedValue([])
  remove.mockResolvedValue({ ok: true })
})

async function mountPopover() {
  const wrapper = await mountInApp(RadioPopover)
  const state = wrapper.findComponent(RadioPopover).vm as unknown as State
  const setOpen = async (open: boolean, settled = true) => {
    state.open = open
    await flushPromises()
    if (settled) await vi.waitFor(() => expect(state.favoritesLoading).toBe(false))
  }
  return { wrapper, state, setOpen }
}

describe('radio split control', () => {
  it('opens settings from either control without a station, and disables both outside voice', async () => {
    const { wrapper, state, setOpen } = await mountPopover()
    await wrapper.find('[aria-label="Radio settings"]').trigger('click')
    expect(state.open).toBe(true)
    await setOpen(false)
    await wrapper.find('[aria-label="Radio options"]').trigger('click')
    expect(state.open).toBe(true)
    expect(playback.listen).not.toHaveBeenCalled()
    expect(playback.mute).not.toHaveBeenCalled()
    await setOpen(false)
    playback.channelId.value = null
    await flushPromises()
    expect(wrapper.find('[aria-label="Radio settings"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[aria-label="Radio options"]').attributes('disabled')).toBeDefined()
  })

  it('pauses and resumes locally without opening settings or stopping the shared station', async () => {
    playback.station.value = { id: 'station', name: 'Jazz' }
    playback.playback.value = 'playing'
    const { wrapper, state } = await mountPopover()
    const button = () => wrapper.findComponent(RadioPopover).findAllComponents({ name: 'UButton' })[0]!
    expect(button().props()).toMatchObject({ color: 'primary', variant: 'soft' })
    await wrapper.find('[aria-label="Pause radio"]').trigger('click')
    expect(playback.mute).toHaveBeenCalledOnce()
    expect(button().props()).toMatchObject({ color: 'neutral', variant: 'ghost' })
    await wrapper.find('[aria-label="Resume radio"]').trigger('click')
    expect(playback.listen).toHaveBeenCalledOnce()
    expect(state.open).toBe(false)
    expect(playback.stop).not.toHaveBeenCalled()
    await wrapper.find('[aria-label="Radio options"]').trigger('click')
    expect(state.open).toBe(true)
    expect(playback.mute).toHaveBeenCalledOnce()
  })

  it.each(['blocked', 'error'])('retries %s playback from the main control', async status => {
    playback.station.value = { id: 'station', name: 'Jazz' }
    playback.playback.value = status
    const { wrapper, state } = await mountPopover()
    await wrapper.find('[aria-label="Resume radio"]').trigger('click')
    expect(playback.listen).toHaveBeenCalledOnce()
    expect(playback.mute).not.toHaveBeenCalled()
    expect(state.open).toBe(false)
  })
})

describe('radio favorites interaction state', () => {
  it('loads on open, filters favorites by name, and defaults to All on reopen', async () => {
    list.mockResolvedValue([favorite])
    const { state, setOpen } = await mountPopover()
    await setOpen(true)
    expect(state.favoritesReady).toBe(true)
    state.favoritesOnly = true
    expect(state.visibleStations).toEqual([favorite])
    state.q = ' JAZZ '
    expect(state.visibleStations).toEqual([favorite])
    state.q = 'classical'
    expect(state.visibleStations).toEqual([])
    await setOpen(false)
    await setOpen(true)
    expect(state.favoritesOnly).toBe(false)
  })

  it('waits for save confirmation and blocks duplicate clicks', async () => {
    let resolve!: (value: unknown) => void
    list.mockResolvedValueOnce([])
    save.mockReturnValueOnce(new Promise(r => (resolve = r)))
    const { state, setOpen } = await mountPopover()
    await setOpen(true)
    const saving = state.toggleFavorite(favorite)
    await state.toggleFavorite(favorite)
    expect(state.favorites).toEqual([])
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    resolve(favorite)
    await saving
    expect(state.favorites).toEqual([favorite])
    expect(state.saving).toEqual([])
  })

  it('preserves the confirmed state after a failed removal and permits retry', async () => {
    list.mockResolvedValueOnce([favorite])
    remove.mockRejectedValueOnce(requestError('offline'))
    const { state, setOpen } = await mountPopover()
    await setOpen(true)
    await state.toggleFavorite(favorite)
    expect(state.favorites).toEqual([favorite])
    expect(state.favoritesError).toBeTruthy()
    expect(state.saving).toEqual([])
    await state.toggleFavorite(favorite)
    expect(state.favorites).toEqual([])
    expect(state.favoritesError).toBe('')
  })

  it('ignores an older load that finishes after a newer load', async () => {
    let resolve!: (value: unknown) => void
    list.mockReturnValueOnce(new Promise(r => (resolve = r))).mockResolvedValueOnce([favorite])
    const { state, setOpen } = await mountPopover()
    await setOpen(true, false)
    await setOpen(false, false)
    await setOpen(true)
    resolve([])
    await flushPromises()
    expect(state.favorites).toEqual([favorite])
    expect(state.favoritesLoading).toBe(false)
  })

  it('shows stored favorites with unknown availability and permits removal during an outage', async () => {
    const stored = { ...favorite, available: null }
    list.mockResolvedValueOnce([stored])
    const { state, setOpen } = await mountPopover()
    await setOpen(true)
    state.favoritesOnly = true
    expect(state.favoritesReady).toBe(true)
    expect(state.visibleStations).toEqual([stored])
    await state.toggleFavorite(stored)
    expect(remove).toHaveBeenCalledOnce()
    expect(state.visibleStations).toEqual([])
    expect(state.favoritesError).toBe('')
  })

  it('keeps saving disabled after a failed load and reloads on reopen', async () => {
    list.mockRejectedValueOnce(requestError('offline')).mockResolvedValueOnce([])
    const { state, setOpen } = await mountPopover()
    await setOpen(true)
    await state.toggleFavorite(favorite)
    expect(save).not.toHaveBeenCalled()
    expect(state.favoritesReady).toBe(false)
    expect(state.favoritesError).toBeTruthy()
    await setOpen(false)
    await setOpen(true)
    expect(state.favoritesReady).toBe(true)
    expect(state.favoritesError).toBe('')
  })
})
