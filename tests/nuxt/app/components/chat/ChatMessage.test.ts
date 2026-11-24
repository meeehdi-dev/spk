import type { MessageDto } from '~~/server/db/messages'

import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import ChatMessage from '~/components/chat/ChatMessage.vue'
import EmojiPicker from '~/components/chat/EmojiPicker.vue'
import { chatActionsKey } from '~/composables/messageContext'
import { mountInApp } from '~~/tests/fixtures/app'

mockNuxtImport('loadEmojiItems', () => async () => [])

interface State {
  root: HTMLElement
  toolbar: HTMLElement
  toolbarStyle: { top: string; left: string; maxWidth: string }
  picker: boolean
  moreOpen: boolean
  pickerPoint?: { x: number; y: number }
  pickerReference?: { getBoundingClientRect: () => DOMRect }
  items: Array<Array<{ label: string; children?: Item[] }> | Item>
  menuContent: { onCloseAutoFocus: (e: Event) => void }
  messageItems: () => Item[]
  setPickerOpen: (open: boolean) => void
}
type Item = { label: string; onSelect: () => void }

const message: MessageDto = {
  id: 'm1',
  channelId: 'c',
  userId: 'a',
  body: 'hello',
  createdAt: 0,
  editedAt: null,
  replyTo: null,
  attachments: [],
  reactions: [],
  previews: [],
  pinned: false,
  poll: null,
}
const actions = { edit: vi.fn(), remove: vi.fn(), react: vi.fn(), reply: vi.fn(), pin: vi.fn(), jump: vi.fn(), removePreview: vi.fn(), openImage: vi.fn() }

beforeAll(() => {
  registerEndpoint('/api/profile/me', () => ({ id: 'a', email: 'a@x.dev', role: 'user', displayName: 'Alex', avatarKey: null }))
  registerEndpoint('/api/users', () => [{ id: 'a', displayName: 'Alex', avatarKey: null, role: 'user' }])
  registerEndpoint('/api/channels', () => [
    { id: 'c', type: 'text', name: 'general' },
    { id: 'd', type: 'dm', name: null },
  ])
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function mountMessage(props: { scroller?: HTMLElement; content?: HTMLElement } = {}) {
  const wrapper = await mountInApp(ChatMessage, { message, grouped: false, ...props }, { global: { provide: { [chatActionsKey as symbol]: actions } } })
  await flushPromises()
  const component = wrapper.findComponent(ChatMessage)
  return { wrapper, component, state: component.vm as unknown as State }
}

function stubResizeObserver() {
  const observers = new Set<{ targets: Set<Element>; callback: ResizeObserverCallback }>()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<Element>()
      constructor(public callback: ResizeObserverCallback) {
        observers.add(this)
      }
      observe(target: Element) {
        this.targets.add(target)
      }
      unobserve(target: Element) {
        this.targets.delete(target)
      }
      disconnect() {
        this.targets.clear()
        observers.delete(this)
      }
    },
  )
  const notify = (target: Element) => {
    for (const observer of [...observers])
      if (observer.targets.has(target)) observer.callback([{ target } as ResizeObserverEntry], observer as unknown as ResizeObserver)
  }
  return { observers, notify }
}

describe('bot badge', () => {
  it('marks messages from the bot only', async () => {
    const mount = (userId: string) =>
      mountInApp(ChatMessage, { message: { ...message, userId }, grouped: false }, { global: { provide: { [chatActionsKey as symbol]: actions } } })
    expect((await mount(BOT_ID)).text()).toContain('BOT')
    expect((await mount('a')).text()).not.toContain('BOT')
  })
})

describe('poll', () => {
  it('renders the poll above reactions', async () => {
    const poll = { options: [{ id: 'o1', label: 'Yes', userIds: ['a'] }] }
    const wrapper = await mountInApp(
      ChatMessage,
      { message: { ...message, poll }, grouped: false },
      { global: { provide: { [chatActionsKey as symbol]: actions } } },
    )
    await flushPromises()
    expect(wrapper.find('button[aria-pressed="true"]').text()).toContain('Yes')
    expect(wrapper.text()).toContain('1 vote')
  })
})

describe('grouped timestamps', () => {
  it.each(['hello', 'first line\nsecond line', 'hello 👍', '👍', '> quoted text', '```\ncode\n```'])(
    'shares the first baseline with %j and keeps the timestamp in flow while hidden',
    async body => {
      const wrapper = await mountInApp(
        ChatMessage,
        { message: { ...message, body }, grouped: true },
        { global: { provide: { [chatActionsKey as symbol]: actions } } },
      )
      await flushPromises()
      expect(wrapper.find('#msg-m1').classes()).toContain('items-baseline')
      const timestamp = wrapper.find('#msg-m1 > div:first-child span')
      expect(timestamp.text()).toBe(clockTime(message.createdAt))
      expect(timestamp.classes()).toEqual(expect.arrayContaining(['invisible', 'group-hover:visible', 'text-xs']))
      expect(timestamp.classes()).not.toContain('absolute')
      expect(timestamp.classes()).not.toContain('hidden')
      expect(timestamp.classes()).not.toContain('leading-6')
    },
  )

  it('keeps bodyless rows top-aligned and leaves ungrouped headers unchanged', async () => {
    const props = reactive({ message: { ...message, body: '' }, grouped: true, editing: false })
    const wrapper = await mountInApp(ChatMessage, props, { global: { provide: { [chatActionsKey as symbol]: actions } } })
    expect(wrapper.find('#msg-m1').classes()).not.toContain('items-baseline')
    props.editing = true
    await nextTick()
    expect(wrapper.find('#msg-m1').classes()).toContain('items-baseline')
    props.grouped = false
    props.editing = false
    await nextTick()
    expect(wrapper.find('#msg-m1').classes()).not.toContain('items-baseline')
    expect(wrapper.find('button[aria-label^="Profile of "]').exists()).toBe(true)
    expect(wrapper.find('.group-hover\\:visible').exists()).toBe(false)
  })
})

describe('emoji rendering', () => {
  it('uses SVGs in messages, reaction chips and quick reactions without changing reaction values', async () => {
    const wrapper = await mountInApp(
      ChatMessage,
      { message: { ...message, body: '👍🏽', reactions: [{ emoji: '❤️', userIds: ['a'] }] }, grouped: false },
      { global: { provide: { [chatActionsKey as symbol]: actions } } },
    )
    await vi.waitFor(() => expect(wrapper.find('[data-body] img[alt="👍🏽"]').exists()).toBe(true))
    expect(wrapper.find('[data-body]').classes()).toContain('chat-emoji-only')
    const chip = wrapper.find('button[aria-pressed]')
    expect(chip.find('img').attributes('alt')).toBe('❤️')
    expect(chip.classes()).toEqual(expect.arrayContaining(['bg-primary/10', 'hover:bg-primary/20', 'border-primary/40']))
    await chip.trigger('click')
    expect(actions.react).toHaveBeenCalledWith('m1', '❤️', false)
    const quick = wrapper.find('button[aria-label^="React with"]')
    expect(quick.find('img').exists()).toBe(true)
    await quick.trigger('click')
    expect(actions.react).toHaveBeenLastCalledWith('m1', quick.find('img').attributes('alt'), true)
  })

  it('gives other reactions a neutral background and keeps selected quick reactions primary on hover', async () => {
    const wrapper = await mountInApp(
      ChatMessage,
      {
        message: {
          ...message,
          reactions: [
            { emoji: '❤️', userIds: ['b'] },
            { emoji: '👍', userIds: ['a'] },
          ],
        },
        grouped: false,
      },
      { global: { provide: { [chatActionsKey as symbol]: actions } } },
    )
    const other = wrapper.find('button[aria-pressed="false"]')
    expect(other.classes()).toEqual(expect.arrayContaining(['bg-(--ui-bg-base)', 'hover:bg-accented', 'border-default', 'text-default']))
    expect(other.classes()).not.toContain('bg-primary/10')
    const quick = wrapper.find('button[aria-label="React with 👍"]')
    expect(quick.classes()).toEqual(expect.arrayContaining(['bg-primary/10', 'hover:bg-primary/20']))
  })
})

describe('message highlights', () => {
  it('highlights mentions and replies to me, but not code, other users or my own messages', async () => {
    const props = reactive({ message, grouped: false, highlighted: false })
    const wrapper = await mountInApp(ChatMessage, props, { global: { provide: { [chatActionsKey as symbol]: actions } } })
    const state = wrapper.findComponent(ChatMessage).vm as unknown as State
    await vi.waitFor(() => expect(useNuxtData<{ id: string }>('me').data.value?.id).toBe('a'))
    const update = async (changes: Partial<MessageDto>, highlighted = false) => {
      props.message = { ...message, userId: 'b', ...changes }
      props.highlighted = highlighted
      await nextTick()
    }
    await vi.waitFor(() => expect(useNuxtData('channels').data.value).toContainEqual({ id: 'c', type: 'text', name: 'general' }))
    await update({ body: 'hello <@a>' })
    expect(state.root.classList).toContain('bg-primary/10')
    expect(state.root.classList).toContain('hover:bg-primary/15')
    await update({ replyTo: { id: 'original', userId: 'a', preview: 'hello', deleted: false } })
    expect(state.root.classList).toContain('bg-primary/10')
    await update({ body: '`<@a>` and <@someone-else>' })
    expect(state.root.classList).not.toContain('bg-primary/10')
    await update({ userId: 'a', body: '<@a>' })
    expect(state.root.classList).not.toContain('bg-primary/10')
    await update({}, true)
    expect(state.root.classList).toContain('bg-inverted/10')
    expect(state.root.classList).not.toContain('bg-primary/10')
    await update({ body: 'hello <@a>' }, true)
    expect(state.root.classList).toContain('bg-inverted/10')
    await update({})
    expect(state.root.classList).not.toContain('bg-inverted/10')
  })
})

describe('message toolbar positioning', () => {
  it('follows an earlier sibling growing using only the content resize signal while a menu keeps the toolbar visible', async () => {
    const { observers, notify } = stubResizeObserver()
    const scroller = document.createElement('div')
    const content = document.createElement('div')
    scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
    const { wrapper, state } = await mountMessage({ scroller, content })
    let earlierHeight = 100
    state.root.getBoundingClientRect = () => ({ top: 100 + earlierHeight, bottom: 160 + earlierHeight, right: 800, width: 600 }) as DOMRect
    Object.defineProperty(state.toolbar, 'offsetHeight', { value: 38 })
    notify(state.toolbar)
    await nextTick()
    expect(state.toolbar.style.top).toBe('200px')
    expect([...observers].some(observer => observer.targets.has(content))).toBe(true)
    // Only the earlier sibling and content change size; the row, toolbar, viewport and scrollTop do not.
    earlierHeight = 200
    notify(content)
    await nextTick()
    expect(state.toolbar.style.top).toBe('300px')
    expect(scroller.scrollTop).toBe(0)
    for (const open of ['picker', 'moreOpen'] as const) {
      expect(state.toolbar.classList).not.toContain('!flex')
      state[open] = true
      await nextTick()
      expect(state.toolbar.classList).toContain('!flex')
      state[open] = false
      await nextTick()
    }
    wrapper.unmount()
    expect([...observers].some(observer => observer.targets.size)).toBe(false)
  })

  it('escapes scrollport clipping without covering the following row, including short compact and partially scrolled tall rows', async () => {
    const { notify } = stubResizeObserver()
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
    const { state } = await mountMessage({ scroller })
    const { root, toolbar } = state
    const resize = async () => {
      notify(root)
      await nextTick()
    }
    let height = 38
    let rowTop = 200
    let rowHeight = 24
    let rowWidth = 300
    Object.defineProperty(toolbar, 'offsetHeight', { get: () => height })
    root.getBoundingClientRect = () => ({ top: rowTop, bottom: rowTop + rowHeight, right: 400, width: rowWidth }) as DOMRect
    expect([...toolbar.classList]).toEqual(expect.arrayContaining(['fixed', '-translate-x-full', '-translate-y-1/2']))
    await resize()
    expect(state.toolbarStyle).toEqual({ top: '200px', left: '384px', maxWidth: '268px' })
    // The toolbar remains centered on the upper edge away from the viewport boundary.
    expect(parseFloat(state.toolbarStyle.top) + height / 2).toBeLessThanOrEqual(rowTop + rowHeight)
    for (const [top, size] of [
      [100, 24],
      [90, 24],
      [-200, 600],
    ]) {
      rowTop = top!
      rowHeight = size!
      scroller.dispatchEvent(new Event('scroll'))
      const center = parseFloat(state.toolbarStyle.top)
      expect(center - height / 2).toBeGreaterThanOrEqual(0)
      expect(center + height / 2).toBeLessThanOrEqual(rowTop + rowHeight)
    }
    expect(state.toolbarStyle.top).toBe('100px')
    height = 0
    await resize()
    const previous = state.toolbarStyle
    rowTop = 300
    scroller.dispatchEvent(new Event('scroll'))
    expect(state.toolbarStyle).toBe(previous)
    height = 38
    await resize()
    expect(state.toolbarStyle.top).toBe('300px')
    rowWidth = 90
    await resize()
    expect(state.toolbarStyle.maxWidth).toBe('58px')
  })
})

describe('message menus and reaction picker', () => {
  const contextMenu = (target: Element, clientX: number, clientY: number) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY })
    target.dispatchEvent(event)
    return event
  }
  const openFrom = (state: State, items: Item[]) => {
    items.find(item => item.label === 'React')!.onSelect()
    expect(state.picker).toBe(false)
    const close = new Event('closeAutoFocus', { cancelable: true })
    state.menuContent.onCloseAutoFocus(close)
    expect(close.defaultPrevented).toBe(true)
    expect(state.picker).toBe(false)
    vi.runAllTimers()
    expect(state.picker).toBe(true)
  }

  it('wires the context and More menus to the shared close-focus handling', async () => {
    const { component, state } = await mountMessage()
    const contextMenu = component.findComponent({ name: 'UContextMenu' })
    expect(contextMenu.props('content')).toBe(state.menuContent)
    expect(contextMenu.props('items')).toEqual(state.items)
    expect(component.findComponent({ name: 'UDropdownMenu' }).props('content')).toEqual({ align: 'end', ...state.menuContent })
  })

  it('waits until menus release focus before replying, including nested context-menu items', async () => {
    const { component, state } = await mountMessage()
    vi.useFakeTimers()
    contextMenu(state.root, 120, 240)
    const directItems = state.items as Item[]
    contextMenu(component.find('button[aria-label="Profile of Alex"]').element, 120, 240)
    const nestedItems = (state.items[1] as Array<{ children?: Item[] }>)[0]!.children!

    for (const items of [directItems, nestedItems, state.messageItems()]) {
      actions.reply.mockClear()
      items.find(item => item.label === 'Reply')!.onSelect()
      await nextTick()
      expect(actions.reply).not.toHaveBeenCalled()
      const close = new Event('closeAutoFocus', { cancelable: true })
      state.menuContent.onCloseAutoFocus(close)
      expect(close.defaultPrevented).toBe(true)
      expect(actions.reply).not.toHaveBeenCalled()
      vi.advanceTimersByTime(0)
      expect(actions.reply).toHaveBeenCalledExactlyOnceWith('m1')
      const subsequentClose = new Event('closeAutoFocus', { cancelable: true })
      state.menuContent.onCloseAutoFocus(subsequentClose)
      vi.advanceTimersByTime(0)
      expect(subsequentClose.defaultPrevented).toBe(false)
      expect(actions.reply).toHaveBeenCalledTimes(1)
    }

    actions.reply.mockClear()
    await component.find('button[aria-label="Reply"]').trigger('click')
    expect(actions.reply).toHaveBeenCalledExactlyOnceWith('m1')
  })

  it('keeps context-menu coordinates through closing and reopening, and restores the toolbar anchor', async () => {
    const { component, state } = await mountMessage()
    vi.useFakeTimers()
    contextMenu(state.root, 120, 240)
    openFrom(state, state.items as Item[])
    expect(state.pickerReference!.getBoundingClientRect().toJSON()).toMatchObject({ x: 120, y: 240, width: 0, height: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 800, clientY: 600 }))
    expect(state.pickerReference!.getBoundingClientRect().x).toBe(120)
    state.setPickerOpen(false)
    expect(state.pickerReference).toBeUndefined()
    expect(state.pickerPoint).toBeUndefined()

    // A nested target (the author's avatar) puts the message's own items in a submenu.
    contextMenu(component.find('button[aria-label="Profile of Alex"]').element, 0, 320)
    openFrom(state, (state.items[1] as Array<{ children?: Item[] }>)[0]!.children!)
    expect(state.pickerReference!.getBoundingClientRect().toJSON()).toMatchObject({ x: 0, y: 320 })
    state.setPickerOpen(false)

    // More uses the same items factory without a context-menu point.
    openFrom(state, state.messageItems())
    expect(state.pickerReference).toBeUndefined()
    state.setPickerOpen(false)
    state.setPickerOpen(true)
    expect(state.pickerReference).toBeUndefined()
    state.setPickerOpen(false)

    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'keep native selection menu' } as Selection)
    const previousItems = state.items
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 500 })
    const stop = vi.spyOn(event, 'stopPropagation')
    state.root.dispatchEvent(event)
    expect(stop).toHaveBeenCalled()
    expect(state.items).toStrictEqual(previousItems)
    expect(state.pickerReference).toBeUndefined()
  })

  it('defers menu-triggered opening until close autofocus, suppresses stolen focus, and closes on pick', async () => {
    const { component, state } = await mountMessage()
    vi.useFakeTimers()
    openFrom(state, state.messageItems())
    vi.useRealTimers()
    await flushPromises()
    component.findComponent(EmojiPicker).vm.$emit('pick', '😀')
    await nextTick()
    expect(state.picker).toBe(false)
    expect(actions.react).toHaveBeenCalledExactlyOnceWith('m1', '😀', true)
  })
})

describe('pinning', () => {
  const pinItem = (state: State) => state.messageItems().find(item => /pin/i.test(item.label))
  it('hides Pin in text channels for non-admins and offers Pin/Unpin in DMs', async () => {
    expect(pinItem((await mountMessage()).state)).toBeUndefined()
    for (const pinned of [false, true]) {
      const wrapper = await mountInApp(
        ChatMessage,
        { message: { ...message, channelId: 'd', pinned }, grouped: false },
        { global: { provide: { [chatActionsKey as symbol]: actions } } },
      )
      await flushPromises()
      const state = wrapper.findComponent(ChatMessage).vm as unknown as State
      const item = pinItem(state)!
      expect(item.label).toBe(pinned ? 'Unpin message' : 'Pin message')
      item.onSelect()
      expect(actions.pin).toHaveBeenLastCalledWith('m1', !pinned)
      expect(wrapper.find('[aria-label="Pinned"]').exists()).toBe(pinned)
    }
  })
})

describe('webhook feed', () => {
  it('shows the webhook as author, renders the embed and offers only delete', async () => {
    registerEndpoint('/api/channels', () => [{ id: 'w', type: 'webhook', name: 'Deploys', icon: 'rocket', ownerId: 'a', private: true }])
    await refreshNuxtData('channels')
    const embed = { title: 'Build failed', color: 'error' as const }
    const wrapper = await mountInApp(
      ChatMessage,
      { message: { ...message, channelId: 'w', embed }, grouped: false },
      { global: { provide: { [chatActionsKey as symbol]: actions } } },
    )
    await vi.waitFor(() => expect(wrapper.find('[data-webhook-name]').text()).toBe('Deploys'))
    expect(wrapper.find('[aria-label="Profile of Alex"]').exists()).toBe(false)
    expect(wrapper.find('[data-embed]').text()).toContain('Build failed')
    for (const label of ['Add reaction', 'Reply', 'Edit message']) expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(false)
  })

  it("lets the feed owner delete alerts but not edit them, even though alerts carry the owner's userId", async () => {
    registerEndpoint('/api/channels', () => [{ id: 'w', type: 'webhook', name: 'Deploys', icon: 'rocket', ownerId: 'a', private: true }])
    await refreshNuxtData('channels')
    const wrapper = await mountInApp(
      ChatMessage,
      { message: { ...message, channelId: 'w', userId: 'a' }, grouped: false },
      { global: { provide: { [chatActionsKey as symbol]: actions } } },
    )
    await vi.waitFor(() => expect(wrapper.find('[data-webhook-name]').text()).toBe('Deploys'))
    expect(wrapper.find('[role="img"][aria-label="Deploys"]').exists()).toBe(true)
    const labels = (wrapper.findComponent(ChatMessage).vm as unknown as State).messageItems().map(i => i.label)
    expect(labels).toContain('Delete')
    expect(labels).not.toContain('Edit')
  })
})
