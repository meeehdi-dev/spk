import type { PinDto } from '~~/server/db/pins'

import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import PinnedBar from '~/components/chat/PinnedBar.vue'
import { chatActionsKey } from '~/composables/messageContext'
import { mountInApp } from '~~/tests/fixtures/app'

const actions = { edit: vi.fn(), remove: vi.fn(), react: vi.fn(), reply: vi.fn(), pin: vi.fn(), jump: vi.fn(), removePreview: vi.fn(), openImage: vi.fn() }
const pin = (id: string, body: string): PinDto => ({
  id,
  channelId: 'c',
  userId: 'a',
  body,
  createdAt: 0,
  editedAt: null,
  replyTo: null,
  attachments: [],
  reactions: [],
  previews: [],
  pinned: true,
  pinnedAt: 0,
  pinnedBy: 'a',
})

beforeAll(() => {
  registerEndpoint('/api/users', () => [{ id: 'a', displayName: 'Alex', avatarKey: null, role: 'user' }])
})
beforeEach(() => vi.clearAllMocks())

async function mountBar(props: { pins: PinDto[]; canPin: boolean }) {
  const p = reactive(props)
  const wrapper = await mountInApp(PinnedBar, p, { attachTo: document.body, global: { provide: { [chatActionsKey as symbol]: actions } } })
  await flushPromises()
  return { wrapper, props: p }
}
const button = (wrapper: Awaited<ReturnType<typeof mountBar>>['wrapper'], text: string) => wrapper.findAll('button').find(b => b.text().includes(text))!

describe('PinnedBar', () => {
  it('renders nothing without pins', async () => {
    const { wrapper } = await mountBar({ pins: [], canPin: true })
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows the latest pin on one line, expands it on click, and goes to it', async () => {
    const { wrapper } = await mountBar({ pins: [pin('m1', 'first line\nsecond line')], canPin: false })
    const line = wrapper.find('[title="Show the latest pinned message"]')
    expect(line.find('.truncate').text()).toContain('first line')
    expect(wrapper.text()).not.toContain('+')
    expect(wrapper.text()).not.toContain('Go to message')
    await line.trigger('click')
    expect(wrapper.find('.whitespace-pre-wrap').text()).toBe('first line\nsecond line')
    expect(wrapper.text()).not.toContain('Unpin')
    await button(wrapper, 'Go to message').trigger('click')
    expect(actions.jump).toHaveBeenCalledExactlyOnceWith('m1')
    expect(wrapper.text()).not.toContain('Go to message')
  })

  it('lists every pin behind +N, each expandable and unpinnable when allowed', async () => {
    const { wrapper, props } = await mountBar({ pins: [pin('m2', 'newest'), pin('m1', 'older')], canPin: true })
    await button(wrapper, '+1').trigger('click')
    expect(wrapper.text()).toContain('older')
    expect(wrapper.text()).not.toContain('Go to message')
    await button(wrapper, 'older').trigger('click')
    await button(wrapper, 'Unpin').trigger('click')
    expect(actions.pin).toHaveBeenCalledExactlyOnceWith('m1', false)
    props.pins = []
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('keeps the open latest view filled when a newer pin arrives or the latest is unpinned', async () => {
    const { wrapper, props } = await mountBar({ pins: [pin('m1', 'older')], canPin: true })
    await wrapper.find('[title="Show the latest pinned message"]').trigger('click')
    props.pins = [pin('m2', 'newest'), pin('m1', 'older')]
    await nextTick()
    expect(wrapper.find('.whitespace-pre-wrap').text()).toBe('newest')
    props.pins = [pin('m1', 'older')]
    await nextTick()
    expect(wrapper.find('.whitespace-pre-wrap').text()).toBe('older')
    expect(wrapper.text()).toContain('Go to message')
  })

  it('closes on Esc and returns focus to the bar, but lets Esc through while closed', async () => {
    const { wrapper } = await mountBar({ pins: [pin('m1', 'only')], canPin: false })
    const line = wrapper.find('[title="Show the latest pinned message"]')
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    await line.trigger('keydown', { key: 'Escape' })
    expect(outer).toHaveBeenCalledTimes(1)
    await line.trigger('click')
    await button(wrapper, 'Go to message').trigger('keydown', { key: 'Escape' })
    expect(outer).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('Go to message')
    expect(document.activeElement).toBe(line.element)
    document.removeEventListener('keydown', outer)
  })
})
