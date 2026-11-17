import type { Editor } from '@tiptap/vue-3'

import { UEditor } from '#components'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
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
