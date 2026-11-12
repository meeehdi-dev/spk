// @vitest-environment happy-dom
import type { ComputedRef, Ref } from 'vue'

import { readFileSync } from 'node:fs'

import { useFuse } from '@vueuse/integrations/useFuse'
import { transpile } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onMounted, ref, shallowRef } from 'vue'
import { parse } from 'vue/compiler-sfc'

const { descriptor } = parse(readFileSync('app/components/chat/EmojiPicker.vue', 'utf8'))
const setup = new Function(
  'defineEmits',
  'shallowRef',
  'ref',
  'computed',
  'onMounted',
  'loadEmojiItems',
  `${transpile(descriptor.scriptSetup!.content)}; return { groups, loading, failed, input }`,
)
const data = [
  { name: 'grinning face', emoji: '😀', shortcodes: ['grin'], tags: ['happy'] },
  { name: 'red heart', emoji: '❤️', shortcodes: ['heart'], tags: ['love'] },
]
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function mount(load = () => Promise.resolve(data)) {
  const emit = vi.fn()
  const palette = defineComponent({
    props: ['groups', 'loading', 'fuse', 'input', 'autofocus'],
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.empty?.()),
  })
  let state!: { groups: ComputedRef<{ items: ((typeof data)[number] & { onSelect: () => void })[] }[]>; loading: Ref<boolean>; failed: Ref<boolean> }
  const app = createApp({
    template: descriptor.template!.content,
    components: { UCommandPalette: palette },
    setup: () => (state = setup(() => emit, shallowRef, ref, computed, onMounted, load)),
  })
  const container = document.createElement('div')
  document.body.append(container)
  const vm = app.mount(container)
  cleanups.push(() => {
    app.unmount()
    container.remove()
  })
  return { emit, state, container, palette: vm.$.subTree.component! }
}

describe('emoji reaction picker', () => {
  it('loads the composer dataset and delegates accessible autofocus/search/list navigation to Nuxt UI', async () => {
    const load = vi.fn(async () => data)
    const { state, palette } = mount(load)
    await nextTick()
    expect(load).toHaveBeenCalledOnce()
    expect(state.loading.value).toBe(false)
    expect(palette.props.autofocus).toBe(true)
    expect(palette.props.input).toEqual({ name: 'emoji-search', 'aria-label': 'Search emoji' })
    expect(palette.props.fuse).toEqual({ fuseOptions: { keys: ['name', 'shortcodes', 'tags'] }, resultLimit: 100 })
  })

  it('finds names, shortcodes and tags with the installed filtering facility, resets on clear, and emits only the selected emoji', async () => {
    const { state, emit, palette } = mount()
    await nextTick()
    type Item = (typeof data)[number] & { onSelect: () => void }
    const items = computed<Item[]>(() => state.groups.value[0]!.items)
    const query = ref('')
    const { results } = useFuse(query, items, palette.props.fuse as { fuseOptions: { keys: string[] }; resultLimit: number })
    for (const term of ['red heart', 'heart', 'love']) {
      query.value = term
      expect(results.value[0]?.item.emoji).toBe('❤️')
    }
    query.value = 'zzzzzzzzzz'
    expect(results.value).toEqual([])
    query.value = ''
    expect(results.value.map(r => r.item.emoji)).toEqual(['😀', '❤️'])
    results.value[1]!.item.onSelect()
    expect(emit.mock.calls).toEqual([['pick', '❤️']])
  })

  it('shows loading, failure and empty feedback without reacting', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<typeof data>((_, no) => (reject = no))
    const { container, emit } = mount(() => pending)
    expect(container.textContent).toContain('Loading emoji…')
    reject(new Error('unavailable'))
    await pending.catch(() => {})
    await nextTick()
    expect(container.textContent).toContain('Could not load emoji.')
    expect(emit).not.toHaveBeenCalled()
    const empty = mount(async () => [])
    await nextTick()
    await nextTick()
    expect(empty.container.textContent).toContain('No emoji found.')
  })

  it('defers menu-triggered opening until close autofocus, suppresses stolen focus, and closes on pick', () => {
    vi.useFakeTimers()
    try {
      const source = readFileSync('app/components/chat/ChatMessage.vue', 'utf8')
      const menu = source.slice(source.indexOf('const messageItems ='), source.indexOf('\nconst items ='))
      const picker = ref(false)
      const react = vi.fn()
      const handlers = new Function(
        'picker',
        'own',
        'canDelete',
        'react',
        `${transpile(`${menu}\n${source.slice(source.indexOf('const pick ='), source.indexOf('const whoReaction ='))}`)}; return { messageItems, menuContent, pick }`,
      )(picker, ref(false), ref(false), react)
      handlers
        .messageItems()
        .find((item: { label: string }) => item.label === 'React')
        .onSelect()
      expect(picker.value).toBe(false)
      const close = new Event('closeAutoFocus', { cancelable: true })
      handlers.menuContent.onCloseAutoFocus(close)
      expect(close.defaultPrevented).toBe(true)
      vi.runAllTimers()
      expect(picker.value).toBe(true)
      handlers.pick('😀')
      expect(picker.value).toBe(false)
      expect(react).toHaveBeenCalledExactlyOnceWith('😀')
      // Escape/arrow/Enter semantics and focus return belong to the existing Nuxt UI/Reka controls.
      expect(source).toContain('<UContextMenu :items="items" :content="menuContent">')
      expect(source).toContain(':content="{ align: \'end\', ...menuContent }"')
      expect(source).toContain('<ChatEmojiPicker @pick="pick" />')
    } finally {
      vi.useRealTimers()
    }
  })
})
