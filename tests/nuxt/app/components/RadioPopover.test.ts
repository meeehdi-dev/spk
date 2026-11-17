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
    boostAvailable: ref<boolean | null>(null),
    commandError: ref(''),
    listen: vi.fn(),
    mute: vi.fn(),
    stop: vi.fn(),
    select: vi.fn(),
    toast: vi.fn(),
  }
})
mockNuxtImport('useToast', () => () => ({ add: playback.toast }))
mockNuxtImport('useRadio', () => () => playback)
mockNuxtImport('useVoice', () => () => ({ channelId: playback.channelId, mute: { value: { deafened: false } } }))

interface State {
  open: boolean
  favoritesOnly: boolean
  favorites: RadioFavorite[]
  favoritesReady: boolean
  favoritesLoading: boolean
  visibleStations: RadioFavorite[]
  q: string
  saving: string[]
  toggleFavorite: (station: RadioFavorite) => Promise<void>
  find: () => Promise<void>
}

const favorite = { id: 'station', name: 'Jazz', country: 'FR', codec: 'MP3', available: true }
const list = vi.fn()
const save = vi.fn()
const remove = vi.fn()
const search = vi.fn()

beforeAll(() => {
  registerEndpoint('/api/radio/stations', () => search())
  registerEndpoint('/api/radio/favorites', () => list())
  registerEndpoint('/api/radio/favorites/station', { method: 'PUT', handler: () => save() })
  registerEndpoint('/api/radio/favorites/station', { method: 'DELETE', handler: () => remove() })
})
beforeEach(() => {
  for (const fn of [list, save, remove, search, playback.listen, playback.mute, playback.stop, playback.select, playback.toast]) fn.mockReset()
  playback.boostAvailable.value = null
  playback.commandError.value = ''
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

async function mountPopover(renderContent = false) {
  const wrapper = await mountInApp(
    RadioPopover,
    {},
    renderContent ? { global: { stubs: { UPopover: { template: '<div><slot /><slot name="content" /></div>' } } } } : {},
  )
  const state = wrapper.findComponent(RadioPopover).vm as unknown as State
  const setOpen = async (open: boolean, settled = true) => {
    state.open = open
    await flushPromises()
    if (settled) await vi.waitFor(() => expect(state.favoritesLoading).toBe(false))
  }
  return { wrapper, state, setOpen }
}

describe('radio split control', () => {
  it('offers 200% and explains when the station cannot be boosted', async () => {
    playback.station.value = { id: 'station', name: 'Jazz' }
    playback.boostAvailable.value = false
    const { wrapper } = await mountPopover(true)
    expect(wrapper.findComponent({ name: 'USlider' }).props('max')).toBe(2)
    expect(wrapper.text()).toContain('Boost unavailable')
    playback.boostAvailable.value = true
    await flushPromises()
    expect(wrapper.text()).not.toContain('Boost unavailable')
  })

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

describe('radio results and feedback', () => {
  it('toasts command errors only from the open popover, without an inline banner or replay on reopen', async () => {
    await mountPopover()
    const { wrapper, setOpen } = await mountPopover(true)
    await setOpen(true)
    playback.commandError.value = 'Radio controls are offline. Wait for reconnection.'
    await flushPromises()
    expect(playback.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'radio-command-error', title: playback.commandError.value, color: 'error' }),
    )
    expect(wrapper.text()).not.toContain(playback.commandError.value)
    await setOpen(false)
    await setOpen(true)
    expect(playback.toast).toHaveBeenCalledOnce()
  })

  it('keeps favorites loading and empty states inside the same bounded results area', async () => {
    let resolve!: (value: unknown) => void
    list.mockReturnValueOnce(new Promise(r => (resolve = r)))
    const { wrapper, state, setOpen } = await mountPopover(true)
    await setOpen(true, false)
    state.favoritesOnly = true
    await flushPromises()
    const results = wrapper.get('[aria-label="Radio stations"]')
    const form = wrapper.get('form').element
    const footer = wrapper.get('a[href="https://www.radio-browser.info/"]').element
    expect(results.classes()).toContain('h-60')
    expect(results.attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).not.toContain('Loading favorites')
    resolve([])
    await vi.waitFor(() => expect(state.favoritesLoading).toBe(false))
    expect(results.attributes('aria-busy')).toBe('false')
    expect(results.text()).toContain('No favorites yet.')
    expect(wrapper.get('form').element).toBe(form)
    expect(wrapper.get('a[href="https://www.radio-browser.info/"]').element).toBe(footer)
  })

  it('keeps validation inline in results and toasts search failures without a false empty state', async () => {
    const { wrapper, state } = await mountPopover(true)
    const results = wrapper.get('[aria-label="Radio stations"]')
    await state.find()
    await flushPromises()
    expect(results.get('[role="alert"]').text()).toBe('Enter at least two characters.')
    expect(playback.toast).not.toHaveBeenCalled()
    state.q = 'jazz'
    search.mockRejectedValueOnce(requestError('offline'))
    await state.find()
    await flushPromises()
    expect(playback.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Radio search is unavailable. Try again later.', color: 'error' }))
    expect(results.text()).not.toContain('No stations found')
    expect(results.find('[role="alert"]').exists()).toBe(false)
    search.mockResolvedValueOnce([])
    await state.find()
    await flushPromises()
    expect(results.text()).toContain('No stations found')
    search.mockResolvedValueOnce([{ ...favorite, url: 'https://example.com/radio' }])
    await state.find()
    await flushPromises()
    expect(results.find('[aria-label="Play Jazz for everyone"]').exists()).toBe(true)
    expect(results.classes()).toContain('h-60')
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
    expect(playback.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not update favorites. Try again. You can save up to 50 stations.', color: 'error' }),
    )
    expect(state.saving).toEqual([])
    await state.toggleFavorite(favorite)
    expect(state.favorites).toEqual([])
    expect(playback.toast).toHaveBeenCalledOnce()
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
    expect(playback.toast).not.toHaveBeenCalled()
  })

  it('keeps saving disabled after a failed load and reloads on reopen', async () => {
    list.mockRejectedValueOnce(requestError('offline')).mockResolvedValueOnce([])
    const { state, setOpen } = await mountPopover()
    await setOpen(true)
    await state.toggleFavorite(favorite)
    expect(save).not.toHaveBeenCalled()
    expect(state.favoritesReady).toBe(false)
    expect(playback.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not load favorites. Close and reopen Radio to retry.', color: 'error' }),
    )
    await setOpen(false)
    await setOpen(true)
    expect(state.favoritesReady).toBe(true)
    expect(playback.toast).toHaveBeenCalledOnce()
  })
})
