import type { GifItem } from '#shared/utils/gifs'

import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import GifPicker from '~/components/chat/GifPicker.vue'
import { mountInApp } from '~~/tests/fixtures/app'
import { gif } from '~~/tests/fixtures/gifs'

const browse = vi.fn()
const list = vi.fn()
const save = vi.fn()
const remove = vi.fn()
interface State {
  tab: string
  q: string
  items: GifItem[]
  favorites: GifItem[]
  favoritesReady: boolean
  favoritesLoading: boolean
  visibleItems: GifItem[]
  loading: boolean
  hasNext: boolean
  error: string
  saving: string[]
  load: (more?: boolean) => Promise<void>
  loadFavorites: () => Promise<void>
  toggleFavorite: (gif: GifItem) => Promise<void>
}

beforeAll(() => {
  registerEndpoint('/api/gifs', () => browse())
  registerEndpoint('/api/gifs/favorites', () => list())
  registerEndpoint(`/api/gifs/favorites/${gif.id}`, { method: 'PUT', handler: () => save() })
  registerEndpoint(`/api/gifs/favorites/${gif.id}`, { method: 'DELETE', handler: () => remove() })
})
beforeEach(() => {
  for (const fn of [browse, list, save, remove]) fn.mockReset()
  browse.mockResolvedValue({ items: [gif], hasNext: false })
  list.mockResolvedValue([])
  save.mockResolvedValue(gif)
  remove.mockResolvedValue({ ok: true })
})
async function mountPicker(settled = true) {
  const wrapper = await mountInApp(GifPicker)
  const picker = wrapper.findComponent(GifPicker)
  const state = picker.vm as unknown as State
  if (settled)
    await vi.waitFor(() => {
      expect(state.loading).toBe(false)
      expect(state.favoritesLoading).toBe(false)
    })
  return { wrapper, picker, state }
}

const failure = (message: string) => new Response(JSON.stringify({ message }), { status: 400, headers: { 'content-type': 'application/json' } })

// Deferred responses exercise actual fetch ordering, not just assigned component state.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

describe('GIF favorites picker', () => {
  it('uses separate accessible star controls without selecting, and preserves pick(url)', async () => {
    const { wrapper, picker, state } = await mountPicker()
    const star = wrapper.get('[aria-label="Add Happy cat to favorites"]')
    expect(star.element.closest('button')?.parentElement?.closest('button')).toBeNull()
    expect(star.attributes('aria-pressed')).toBe('false')
    await star.trigger('click')
    await vi.waitFor(() => expect(state.favorites).toEqual([gif]))
    expect(picker.emitted('pick')).toBeUndefined()
    expect(wrapper.get('[aria-label="Remove Happy cat from favorites"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('button[aria-label="Happy cat"]').trigger('click')
    expect(picker.emitted('pick')).toEqual([[gif.url]])
    await wrapper.get('[aria-label="Remove Happy cat from favorites"]').trigger('click')
    await vi.waitFor(() => expect(state.favorites).toEqual([]))
  })

  it('filters favorites locally and keeps them selectable when Browse is unavailable', async () => {
    browse.mockResolvedValue(failure('GIFs are not set up'))
    list.mockResolvedValue([gif])
    const { wrapper, picker, state } = await mountPicker()
    await wrapper.get('[role="tab"][data-state="inactive"]').trigger('mousedown', { button: 0 })
    expect(state.tab).toBe('favorites')
    state.q = ' CAT '
    await flushPromises()
    expect(state.visibleItems).toEqual([gif])
    expect(wrapper.text()).not.toContain('GIFs are not set up')
    await wrapper.get('button[aria-label="Happy cat"]').trigger('click')
    expect(picker.emitted('pick')).toEqual([[gif.url]])
    state.q = 'dog'
    await vi.waitFor(() => expect(wrapper.text()).toContain('No favorites match your search.'))
    await new Promise(r => setTimeout(r, 400))
    expect(browse).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2)
  })

  it('shows loading and empty states, and disables stars until the saved list is known', async () => {
    const pending = deferred<GifItem[]>()
    list.mockReturnValue(pending.promise)
    const { wrapper, state } = await mountPicker(false)
    await vi.waitFor(() => expect(state.items).toEqual([gif]))
    expect(wrapper.get('[aria-label="Add Happy cat to favorites"]').attributes('disabled')).toBeDefined()
    await state.toggleFavorite(gif)
    expect(save).not.toHaveBeenCalled()
    state.tab = 'favorites'
    await flushPromises()
    expect(wrapper.text()).toContain('Loading GIFs')
    expect(wrapper.text()).not.toContain('No favorites yet')
    pending.resolve([])
    await vi.waitFor(() => expect(wrapper.text()).toContain('No favorites yet. Star a GIF to save it.'))
  })

  it('offers retry after a favorites failure without treating unknown favorites as empty', async () => {
    list.mockResolvedValueOnce(failure('Favorites offline'))
    const { wrapper, state } = await mountPicker()
    state.tab = 'favorites'
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Favorites offline')
    expect(wrapper.text()).not.toContain('No favorites yet')
    expect(state.favoritesReady).toBe(false)
    list.mockResolvedValue([gif])
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Retry favorites')!
      .trigger('click')
    await vi.waitFor(() => expect(state.favoritesReady).toBe(true))
    expect(state.favoritesReady).toBe(true)
    expect(state.favorites).toEqual([gif])
  })

  it('guards duplicate mutations, waits for confirmation, and retains state on failure', async () => {
    const pending = deferred<GifItem>()
    save.mockReturnValueOnce(pending.promise)
    const { wrapper, state } = await mountPicker()
    const saving = state.toggleFavorite(gif)
    await state.toggleFavorite(gif)
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(state.favorites).toEqual([])
    expect(state.saving).toEqual([gif.id])
    pending.resolve(gif)
    await saving
    remove.mockResolvedValueOnce(failure('Could not remove'))
    await state.toggleFavorite(gif)
    expect(state.favorites).toEqual([gif])
    expect(state.saving).toEqual([])
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not remove')
    await state.toggleFavorite(gif)
    expect(state.favorites).toEqual([])
  })

  it('reports save limit failures without adding a favorite', async () => {
    save.mockResolvedValueOnce(failure('You can save up to 50 GIF favorites.'))
    const { wrapper, state } = await mountPicker()
    await state.toggleFavorite(gif)
    expect(state.favorites).toEqual([])
    expect(wrapper.get('[role="alert"]').text()).toContain('You can save up to 50 GIF favorites.')
  })

  it('ignores a late browse result after query changes, including during debounce', async () => {
    const pending = deferred<{ items: GifItem[]; hasNext: boolean }>()
    browse.mockReturnValueOnce(pending.promise)
    const { state } = await mountPicker(false)
    await vi.waitFor(() => expect(browse).toHaveBeenCalledOnce())
    state.q = 'new'
    pending.resolve({ items: [gif], hasNext: true })
    await flushPromises()
    expect(state.items).toEqual([])
    expect(state.hasNext).toBe(false)
    await vi.waitFor(() => expect(browse).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(state.items).toEqual([gif]))
  })

  it('ignores late browse results on tab switches and avoids duplicate pagination', async () => {
    const pending = deferred<{ items: GifItem[]; hasNext: boolean }>()
    browse.mockResolvedValueOnce({ items: [gif], hasNext: true }).mockReturnValueOnce(pending.promise)
    const { state } = await mountPicker()
    const loading = state.load(true)
    await state.load(true)
    await vi.waitFor(() => expect(browse).toHaveBeenCalledTimes(2))
    state.tab = 'favorites'
    pending.resolve({ items: [{ ...gif, id: 'late' }], hasNext: true })
    await loading
    expect(state.items).toEqual([])
    expect(state.hasNext).toBe(false)
    expect(state.error).toBe('')
  })

  it('ignores an older favorites list and responses after unmount', async () => {
    const old = deferred<GifItem[]>()
    list.mockReturnValueOnce(old.promise).mockResolvedValueOnce([gif])
    const { wrapper, state } = await mountPicker(false)
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
    await state.loadFavorites()
    old.resolve([])
    await flushPromises()
    expect(state.favorites).toEqual([gif])
    const pending = deferred<unknown>()
    remove.mockReturnValueOnce(pending.promise)
    const removing = state.toggleFavorite(gif)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    state.q = 'pending debounce'
    wrapper.unmount()
    pending.resolve({ ok: true })
    await removing
    await state.loadFavorites()
    await state.toggleFavorite(gif)
    const requests = browse.mock.calls.length
    await new Promise(r => setTimeout(r, 400))
    expect(browse).toHaveBeenCalledTimes(requests)
    expect(list).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledOnce()
    expect(state.favorites).toEqual([gif])
  })
})
