import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createError, getQuery } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Changelog from '~/components/settings/Changelog.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const toast = vi.hoisted(() => vi.fn())
mockNuxtImport('useToast', () => () => ({ add: toast }))

const scroll = vi.hoisted(() => ({
  load: undefined as (() => Promise<void>) | undefined,
  canLoad: undefined as (() => boolean) | undefined,
  element: undefined as (() => HTMLElement | null | undefined) | undefined,
}))
mockNuxtImport(
  'useInfiniteScroll',
  () => (element: () => HTMLElement | null | undefined, load: () => Promise<void>, options: { canLoadMore: () => boolean }) => {
    scroll.element = element
    scroll.load = load
    scroll.canLoad = options.canLoadMore
  },
)

const sha = 'a'.repeat(40)
const requests: Record<string, unknown>[] = []
let fail: boolean
let empty: boolean
let pending: Promise<void> | undefined

beforeEach(() => {
  toast.mockClear()
  requests.length = 0
  fail = false
  empty = false
  pending = undefined
  registerEndpoint('/api/changelog', {
    handler: async event => {
      const query = getQuery(event)
      requests.push(query)
      await pending
      if (fail) throw createError({ statusCode: 503 })
      if (empty) return { commits: [], head: null, nextPage: null }
      return query.page === '1'
        ? { commits: [{ sha, message: 'feat: first commit', date: '2026-05-21' }], head: sha, nextPage: 2 }
        : {
            commits: [
              { sha, message: 'feat: first commit', date: '2026-05-21' },
              { sha: 'b'.repeat(40), message: '<b>plain text</b>', date: '2026-05-21' },
              { sha: 'c'.repeat(40), message: 'fix: older commit', date: '2026-05-20' },
            ],
            head: sha,
            nextPage: null,
          }
    },
  })
})

describe('settings changelog', () => {
  it('groups across pages, deduplicates and links short hashes while rendering messages as text', async () => {
    const wrapper = await mountInApp(Changelog)
    await vi.waitFor(() => expect(wrapper.text()).toContain('feat: first commit'))
    expect(scroll.element?.()).toBe(wrapper.findComponent(Changelog).element.parentElement)
    expect(wrapper.find('a').text()).toBe('aaaaaaa')
    expect(wrapper.find('a').attributes('href')).toBe(`https://github.com/meeehdi-dev/spk/commit/${sha}`)
    expect(scroll.canLoad?.()).toBe(true)
    await scroll.load?.()
    await flushPromises()
    expect(requests).toEqual([{ page: '1' }, { page: '2', head: sha }])
    expect(wrapper.findAll('time').map(time => time.text())).toEqual(['May 21, 2026', 'May 20, 2026'])
    expect(wrapper.findAll('li')).toHaveLength(3)
    expect(wrapper.text()).toContain('<b>plain text</b>')
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('End of commit history.')
    expect(scroll.canLoad?.()).toBe(false)
  })

  it('keeps loaded commits on failure and retries the same page', async () => {
    const wrapper = await mountInApp(Changelog)
    await vi.waitFor(() => expect(wrapper.text()).toContain('feat: first commit'))
    const footer = wrapper.find('[role="status"]')
    const button = footer.find('button').element
    fail = true
    await scroll.load?.()
    await flushPromises()
    expect(wrapper.text()).toContain('feat: first commit')
    expect(wrapper.text()).not.toContain('Changelog is unavailable.')
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: 'Changelog is unavailable. Try again later.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    expect(footer.classes()).toContain('min-h-8')
    expect(footer.find('button').element).toBe(button)
    expect(footer.find('button').text()).toBe('Retry')
    expect(scroll.canLoad?.()).toBe(false)
    fail = false
    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('End of commit history.'))
    expect(wrapper.find('[role="status"]').element).toBe(footer.element)
    expect(footer.classes()).toContain('min-h-8')
    expect(footer.find('button').exists()).toBe(false)
    expect(requests.slice(1)).toEqual([
      { page: '2', head: sha },
      { page: '2', head: sha },
    ])
  })

  it('offers a retry after the initial request fails without adding an inline error', async () => {
    fail = true
    const wrapper = await mountInApp(Changelog)
    await vi.waitFor(() => expect(toast).toHaveBeenCalledOnce())
    const footer = wrapper.find('[role="status"]')
    expect(footer.text()).toBe('Retry')
    expect(scroll.canLoad?.()).toBe(false)
    fail = false
    let release!: () => void
    pending = new Promise(resolve => {
      release = resolve
    })
    await footer.find('button').trigger('click')
    expect(footer.text()).toBe('Loading commits…')
    expect(footer.find('button').attributes('disabled')).toBeDefined()
    release()
    await vi.waitFor(() => expect(wrapper.text()).toContain('feat: first commit'))
    expect(requests).toEqual([{ page: '1' }, { page: '1' }])
    expect(footer.text()).toBe('Load more')
    expect(scroll.canLoad?.()).toBe(true)
  })

  it('shows the empty state', async () => {
    empty = true
    const wrapper = await mountInApp(Changelog)
    await vi.waitFor(() => expect(wrapper.text()).toContain('No commits yet.'))
    expect(scroll.canLoad?.()).toBe(false)
  })

  it('does not issue overlapping requests', async () => {
    let release!: () => void
    pending = new Promise(resolve => {
      release = resolve
    })
    const wrapper = await mountInApp(Changelog)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const footer = wrapper.find('[role="status"]')
    const button = footer.find('button')
    expect(button.text()).toBe('Loading commits…')
    expect(button.attributes('disabled')).toBeDefined()
    expect(footer.classes()).toContain('min-h-8')
    await button.trigger('click')
    await scroll.load?.()
    expect(requests).toHaveLength(1)
    release()
    await vi.waitFor(() => expect(wrapper.text()).toContain('feat: first commit'))
    expect(footer.find('button').element).toBe(button.element)
    expect(button.text()).toBe('Load more')
    expect(button.attributes('disabled')).toBeUndefined()
  })
})
