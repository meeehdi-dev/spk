import type { Editor } from '@tiptap/vue-3'

import { UEditor } from '#components'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { closeHistory } from '@tiptap/pm/history'
import { flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { ref } from 'vue'

import MessageInput from '~/components/chat/MessageInput.vue'
import { mountInApp } from '~~/tests/fixtures/app'

mockNuxtImport('loadEmojiItems', () => async () => [])
mockNuxtImport('useUsers', () => () => ({ data: ref([]) }))

it.each(['', 'hello', 'hello\n\n\n\nworld'])('toggles quotes repeatedly without adding paragraphs to %j', async content => {
  const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
  await flushPromises()
  const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
  editor.commands.setContent(content, { contentType: 'markdown' })
  await flushPromises()
  const original = editor.getJSON()
  for (let i = 0; i < 3; i++) {
    editor.commands.selectAll()
    await wrapper.get('[aria-label="Quote"]').trigger('click')
    await flushPromises()
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.type.name).toBe('blockquote')
    editor.commands.setTextSelection({ from: 2, to: editor.state.doc.content.size - 2 })
    editor.commands.keyboardShortcut('Mod-Shift->')
    await flushPromises()
    expect(editor.getJSON()).toEqual(original)
  }
})

it.each(['toggleCodeBlock', 'toggleBulletList', 'toggleOrderedList'] as const)(
  '%s does not absorb automatic empty paragraphs when toggling the whole draft',
  async command => {
    const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
    const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
    editor.commands.setContent('hello', { contentType: 'markdown' })
    await flushPromises()
    const original = editor.getJSON()
    for (let i = 0; i < 3; i++) {
      editor.commands.selectAll()
      if (command === 'toggleCodeBlock') await wrapper.get('[aria-label="Code block"]').trigger('click')
      else editor.commands[command]()
      await flushPromises()
      expect(editor.state.doc.childCount).toBe(1)
      editor.commands.selectAll()
      editor.commands[command]()
      await flushPromises()
      expect(editor.getJSON()).toEqual(original)
    }
  },
)

it.each([
  { content: '```\nx\n```', keys: ['Shift-Enter'] },
  { content: '```\nx\n```', keys: ['Enter', 'Enter', 'Enter'] },
  { content: '- x', keys: ['Enter', 'Enter'] },
  { content: '1. x', keys: ['Enter', 'Enter'] },
])('leaves one editable paragraph when exiting $content with $keys', async ({ content, keys }) => {
  const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
  const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
  editor.commands.setContent(content, { contentType: 'markdown' })
  await flushPromises()
  const block = editor.state.doc.firstChild!
  editor.commands.setTextSelection(block.type.name === 'codeBlock' ? block.nodeSize - 1 : 4)
  for (const key of keys)
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: key === 'Shift-Enter' })))
  await flushPromises()
  expect(editor.state.doc.childCount).toBe(2)
  expect(editor.state.doc.lastChild?.type.name).toBe('paragraph')
  expect(editor.state.doc.lastChild?.content.size).toBe(0)
  expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
  expect(editor.getMarkdown().trim()).toBe(content)
  editor.commands.insertContent('reply')
  expect(editor.state.doc.lastChild?.textContent).toBe('reply')
})

it.each(['hello\n\n\n\nworld', '```\nx\n```', '- x', '1. x', '> x\n\n'])(
  'keeps paragraph counts stable across Markdown and draft round trips for %j',
  async content => {
    const channelId = crypto.randomUUID()
    const wrapper = await mountInApp(MessageInput, { channelId, channelName: 'general' })
    const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
    editor.commands.setContent(content, { contentType: 'markdown' })
    await flushPromises()
    const original = editor.getJSON()
    for (let i = 0; i < 3; i++) {
      editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' })
      await flushPromises()
      expect(editor.getJSON()).toEqual(original)
    }
    wrapper.unmount()
    const restored = await mountInApp(MessageInput, { channelId, channelName: 'general' })
    await flushPromises()
    const restoredEditor = (restored.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
    expect(restoredEditor.getJSON()).toEqual(original)
  },
)

it.each(['toggleCodeBlock', 'toggleBulletList', 'toggleOrderedList', 'toggleBlockquote'] as const)(
  'undoes and redoes %s without generating blank paragraphs',
  async command => {
    const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
    const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
    editor.commands.setContent('hello', { contentType: 'markdown' })
    await flushPromises()
    const original = editor.getJSON()
    editor.view.dispatch(closeHistory(editor.state.tr))
    editor.commands[command]()
    await flushPromises()
    const formatted = editor.getJSON()
    for (let i = 0; i < 3; i++) {
      editor.commands.undo()
      await flushPromises()
      expect(editor.getJSON()).toEqual(original)
      editor.commands.redo()
      await flushPromises()
      expect(editor.getJSON()).toEqual(formatted)
      expect(editor.state.doc.childCount).toBe(1)
    }
  },
)

it.each(['<pre><code>x</code></pre>', '<ul><li>x</li></ul>', '<ol><li>x</li></ol>', '<blockquote><p>x</p></blockquote>'])(
  'pastes %j without appending a blank paragraph',
  async html => {
    const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
    const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
    editor.view.pasteHTML(html)
    await flushPromises()
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.textContent).toBe('x')
  },
)

it('retains an editable paragraph after an atomic horizontal rule', async () => {
  const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
  const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
  editor.commands.setContent('---', { contentType: 'markdown' })
  await flushPromises()
  expect(editor.getJSON().content?.map(node => node.type)).toEqual(['horizontalRule', 'paragraph'])
})

it('inserts quotes with one editable paragraph after the quote', async () => {
  const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
  const input = wrapper.findComponent(MessageInput)
  const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
  const quote = (text: string) => (input.vm as unknown as { quote: (text: string) => void }).quote(text)
  quote('first')
  await flushPromises()
  expect(editor.getJSON().content?.map(node => node.type)).toEqual(['blockquote', 'paragraph'])
  quote('second')
  await flushPromises()
  expect(editor.getJSON().content?.map(node => node.type)).toEqual(['blockquote', 'paragraph', 'blockquote', 'paragraph'])
  editor.commands.insertContent('reply')
  expect(editor.state.doc.lastChild?.textContent).toBe('reply')
})

it('keeps the same editor side padding on phones and desktop', async () => {
  const wrapper = await mountInApp(MessageInput, { channelId: crypto.randomUUID(), channelName: 'general' })
  const classes = wrapper.get('.ProseMirror').classes()
  expect(classes).toEqual(expect.arrayContaining(['px-3', 'sm:px-3']))
  expect(classes).not.toContain('sm:px-8')
})
