import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EmojiPicker from '~/components/chat/EmojiPicker.vue'

const data = [
  { name: 'grinning face', emoji: '😀', shortcodes: ['grin'], tags: ['happy'] },
  { name: 'red heart', emoji: '❤️', shortcodes: ['heart'], tags: ['love'] },
]
const load = vi.hoisted(() => vi.fn())
mockNuxtImport('loadEmojiItems', () => load)

beforeEach(() => load.mockReset().mockResolvedValue(data))

async function mountPicker() {
  const wrapper = await mountSuspended(EmojiPicker, { attachTo: document.body })
  await flushPromises()
  const input = wrapper.find('input[name="emoji-search"]')
  const shown = () => wrapper.findAll('[role="option"]').map(option => option.text())
  const search = async (term: string, expected: (results: string[]) => void) => {
    await input.setValue(term)
    await vi.waitFor(() => expected(shown()))
  }
  return { wrapper, input, search, shown }
}

describe('emoji reaction picker', () => {
  it('loads the composer dataset into an autofocused, labelled Nuxt UI command palette', async () => {
    const { wrapper, input } = await mountPicker()
    expect(load).toHaveBeenCalledOnce()
    expect(input.attributes('aria-label')).toBe('Search emoji')
    await vi.waitFor(() => expect(document.activeElement).toBe(input.element))
    expect(wrapper.findComponent({ name: 'UCommandPalette' }).props('fuse')).toEqual({
      fuseOptions: { keys: ['name', 'shortcodes', 'tags'] },
      resultLimit: 100,
    })
    wrapper.unmount()
  })

  it('finds names, shortcodes and tags, resets on clear, and emits only the selected emoji', async () => {
    const { wrapper, search, shown } = await mountPicker()
    expect(shown()).toHaveLength(2)
    for (const term of ['red heart', 'heart', 'love']) await search(term, results => expect(results).toEqual([expect.stringContaining('❤️')]))
    await search('zzzzzzzzzz', results => expect(results).toEqual([]))
    expect(wrapper.text()).toContain('No emoji found.')
    await search('', results => expect(results).toHaveLength(2))
    expect(shown()[0]).toContain('😀')
    await wrapper.findAll('[role="option"]')[1]!.trigger('click')
    expect(wrapper.emitted('pick')).toEqual([['❤️']])
    wrapper.unmount()
  })

  it('shows loading, failure and empty feedback without reacting', async () => {
    let reject!: (error: Error) => void
    load.mockReturnValueOnce(new Promise((_, no) => (reject = no)))
    const wrapper = await mountSuspended(EmojiPicker)
    expect(wrapper.text()).toContain('Loading emoji…')
    reject(new Error('unavailable'))
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load emoji.')
    expect(wrapper.emitted('pick')).toBeUndefined()
    load.mockResolvedValueOnce([])
    const empty = await mountSuspended(EmojiPicker)
    await flushPromises()
    expect(empty.text()).toContain('No emoji found.')
  })
})
