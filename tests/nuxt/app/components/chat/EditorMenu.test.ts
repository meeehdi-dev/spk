import { useNuxtApp } from '#app'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { Editor } from '@tiptap/vue-3'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'

import EditorMenu from '~/components/chat/EditorMenu.vue'
import { chatMarkExtensions } from '~/utils/editor-extensions'

it('renders searchable Twemoji suggestions and inserts Unicode with keyboard navigation', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const element = document.createElement('div')
  host.append(element)
  const editor = new Editor({ element, extensions: [StarterKit, Markdown] })
  const wrapper = await mountSuspended(EditorMenu, {
    props: {
      kind: 'emoji',
      editor,
      items: [
        { name: 'grinning face', emoji: '😀', shortcodes: ['grin'], tags: ['happy'] },
        { name: 'red heart', emoji: '❤️', shortcodes: ['heart'], tags: ['love'] },
      ],
    },
  })
  try {
    await flushPromises()
    editor.commands.insertContent(':')
    await vi.waitFor(() => expect(host.querySelectorAll('[role="option"] img')).toHaveLength(2))
    expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^\/twemoji\/.+\/1f600.svg$/)
    const key = (value: string) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
    key('ArrowDown')
    key('Enter')
    await flushPromises()
    expect(editor.getMarkdown()).toBe('❤️')
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    editor.commands.setContent('')
    editor.commands.insertContent(':love')
    await vi.waitFor(() => expect(host.querySelectorAll('[role="option"] img')).toHaveLength(1))
    expect(host.querySelector('[role="option"] img')?.getAttribute('alt')).toBe('❤️')
    key('Escape')
    await flushPromises()
    expect(editor.getMarkdown()).toBe(':love')
    expect(host.querySelector('[role="listbox"]')).toBeNull()
  } finally {
    wrapper.unmount()
    editor.destroy()
    host.remove()
  }
})

it('renders emoji in mention suggestions without changing the inserted user ID', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const element = document.createElement('div')
  host.append(element)
  const editor = new Editor({ element, extensions: [StarterKit, Markdown, ...chatMarkExtensions(() => 'Alex 😀')] })
  editor.appContext = useNuxtApp().vueApp._context
  const wrapper = await mountSuspended(EditorMenu, {
    props: { kind: 'mention', editor, items: [{ id: 'u1', label: 'Alex 😀', avatar: { alt: 'Alex 😀', icon: 'i-lucide-user' } }] },
  })
  try {
    await flushPromises()
    editor.commands.insertContent('@Alex')
    await vi.waitFor(() => expect(host.querySelector('[role="option"] img[alt="😀"]')).not.toBeNull())
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(editor.getMarkdown()).toBe('<@u1>')
    expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({ type: 'mention', attrs: { id: 'u1', label: 'Alex 😀' } })
  } finally {
    wrapper.unmount()
    editor.destroy()
    host.remove()
  }
})

it('suggests slash commands at the start of the line and emits the chosen one', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const element = document.createElement('div')
  host.append(element)
  const editor = new Editor({ element, extensions: [StarterKit, Markdown] })
  editor.appContext = useNuxtApp().vueApp._context
  const wrapper = await mountSuspended(EditorMenu, {
    props: {
      kind: 'command',
      editor,
      items: [
        { label: 'gif', description: 'Search for a GIF', icon: 'i-lucide-image-play' },
        { label: 'poll', description: 'Create a poll', icon: 'i-lucide-chart-bar' },
      ],
    },
  })
  try {
    await flushPromises()
    editor.commands.insertContent('/po')
    await vi.waitFor(() => expect(host.querySelectorAll('[role="option"]')).toHaveLength(1))
    expect(host.querySelector('[role="option"]')?.textContent).toContain('/poll')
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.emitted('command')).toEqual([['poll']])
    expect(editor.getText()).toBe('')
    editor.commands.insertContent('hi /po')
    await flushPromises()
    expect(host.querySelector('[role="listbox"]')).toBeNull()
  } finally {
    wrapper.unmount()
    editor.destroy()
    host.remove()
  }
})
