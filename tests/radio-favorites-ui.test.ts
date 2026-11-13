import { readFileSync } from 'node:fs'

import { transpile } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref, watch } from 'vue'

const source = readFileSync('app/components/RadioPopover.vue', 'utf8')
const setup = new Function(
  'ref',
  'computed',
  'watch',
  'useVoice',
  'useRadio',
  '$fetch',
  `${transpile(source.slice(source.indexOf('const v ='), source.indexOf('</script>')))};
return { open, favoritesOnly, favorites, favoritesReady, favoritesLoading, favoritesError, stations, visibleStations, q, toggleFavorite, saving }`,
)
const favorite = { id: 'station', name: 'Jazz', country: 'FR', codec: 'MP3', available: true }
const scopes: ReturnType<typeof effectScope>[] = []
function mount(fetcher: ReturnType<typeof vi.fn>) {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() =>
    setup(
      ref,
      computed,
      watch,
      () => ({}),
      () => ({}),
      fetcher,
    ),
  )!
}
const flush = async () => {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
afterEach(() => {
  for (const scope of scopes) scope.stop()
  scopes.length = 0
})

describe('radio favorites interaction state', () => {
  it('loads on open, filters favorites by name, and defaults to All on reopen', async () => {
    const state = mount(vi.fn().mockResolvedValue([favorite]))
    state.open.value = true
    await flush()
    expect(state.favoritesReady.value).toBe(true)
    state.favoritesOnly.value = true
    expect(state.visibleStations.value).toEqual([favorite])
    state.q.value = ' JAZZ '
    expect(state.visibleStations.value).toEqual([favorite])
    state.q.value = 'classical'
    expect(state.visibleStations.value).toEqual([])
    state.open.value = false
    await flush()
    state.open.value = true
    await flush()
    expect(state.favoritesOnly.value).toBe(false)
  })
  it('waits for save confirmation and blocks duplicate clicks', async () => {
    let resolve!: (value: unknown) => void
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementation(
        () =>
          new Promise(r => {
            resolve = r
          }),
      )
    const state = mount(fetcher)
    state.open.value = true
    await flush()
    const saving = state.toggleFavorite(favorite)
    await state.toggleFavorite(favorite)
    expect(state.favorites.value).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(2)
    resolve(favorite)
    await saving
    expect(state.favorites.value).toEqual([favorite])
    expect(state.saving.value).toEqual([])
  })
  it('preserves the confirmed state after a failed removal and permits retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce([favorite]).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true })
    const state = mount(fetcher)
    state.open.value = true
    await flush()
    await state.toggleFavorite(favorite)
    expect(state.favorites.value).toEqual([favorite])
    expect(state.favoritesError.value).toBeTruthy()
    expect(state.saving.value).toEqual([])
    await state.toggleFavorite(favorite)
    expect(state.favorites.value).toEqual([])
    expect(state.favoritesError.value).toBe('')
  })
  it('ignores an older load that finishes after a newer load', async () => {
    let resolve!: (value: unknown) => void
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(r => {
            resolve = r
          }),
      )
      .mockResolvedValueOnce([favorite])
    const state = mount(fetcher)
    state.open.value = true
    await flush()
    state.open.value = false
    await flush()
    state.open.value = true
    await flush()
    resolve([])
    await flush()
    expect(state.favorites.value).toEqual([favorite])
    expect(state.favoritesLoading.value).toBe(false)
  })
  it('shows stored favorites with unknown availability and permits removal during an outage', async () => {
    const stored = { ...favorite, available: null }
    const fetcher = vi.fn().mockResolvedValueOnce([stored]).mockResolvedValueOnce({ ok: true })
    const state = mount(fetcher)
    state.open.value = true
    await flush()
    state.favoritesOnly.value = true
    expect(state.favoritesReady.value).toBe(true)
    expect(state.visibleStations.value).toEqual([stored])
    await state.toggleFavorite(stored)
    expect(fetcher).toHaveBeenLastCalledWith('/api/radio/favorites/station', { method: 'DELETE' })
    expect(state.visibleStations.value).toEqual([])
    expect(state.favoritesError.value).toBe('')
  })
  it('keeps saving disabled after a failed load and reloads on reopen', async () => {
    const state = mount(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]))
    state.open.value = true
    await flush()
    await state.toggleFavorite(favorite)
    expect(state.favoritesReady.value).toBe(false)
    expect(state.favoritesError.value).toBeTruthy()
    state.open.value = false
    await flush()
    state.open.value = true
    await flush()
    expect(state.favoritesReady.value).toBe(true)
    expect(state.favoritesError.value).toBe('')
  })
})
