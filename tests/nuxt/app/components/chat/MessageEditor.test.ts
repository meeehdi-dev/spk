import type { Editor } from '@tiptap/vue-3'

import { UEditor } from '#components'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { ref } from 'vue'

import MessageEditor from '~/components/chat/MessageEditor.vue'
import { mountInApp } from '~~/tests/fixtures/app'

mockNuxtImport('loadEmojiItems', () => async () => [])
mockNuxtImport('useUsers', () => () => ({ data: ref([]) }))

it.each(['toggleCodeBlock', 'toggleBulletList', 'toggleOrderedList'] as const)(
  '%s toggles and exits without extra paragraphs in the saved message',
  async command => {
    const wrapper = await mountInApp(MessageEditor, { body: 'hello' })
    await flushPromises()
    const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
    const original = editor.getJSON()
    for (let i = 0; i < 3; i++) {
      editor.commands.selectAll()
      editor.commands[command]()
      await flushPromises()
      expect(editor.state.doc.childCount).toBe(1)
      editor.commands.selectAll()
      editor.commands[command]()
      await flushPromises()
      expect(editor.getJSON()).toEqual(original)
    }
    editor.commands[command]()
    editor.commands.focus('end')
    editor.commands.keyboardShortcut(command === 'toggleCodeBlock' ? 'Shift-Enter' : 'Enter')
    if (command !== 'toggleCodeBlock') editor.commands.keyboardShortcut('Enter')
    await flushPromises()
    expect(editor.state.doc.childCount).toBe(2)
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Save')!
      .trigger('click')
    const saved = wrapper.findComponent(MessageEditor).emitted('save')?.[0]?.[0]
    expect(saved).toBe(command === 'toggleCodeBlock' ? '```\nhello\n```' : command === 'toggleBulletList' ? '- hello' : '1. hello')
  },
)

it('toggles quotes without adding empty paragraphs to the saved message', async () => {
  const wrapper = await mountInApp(MessageEditor, { body: 'hello' })
  await flushPromises()
  const editor = (wrapper.findComponent(UEditor).vm as unknown as { editor: Editor }).editor
  for (let i = 0; i < 3; i++) {
    editor.commands.selectAll()
    editor.commands.keyboardShortcut('Mod-Shift->')
    await flushPromises()
    expect(editor.getMarkdown()).toBe('> hello')
    expect(editor.state.doc.childCount).toBe(1)
    editor.commands.setTextSelection({ from: 2, to: editor.state.doc.content.size - 2 })
    editor.commands.keyboardShortcut('Mod-Shift->')
    await flushPromises()
    expect(editor.getMarkdown()).toBe('hello')
  }
  await wrapper
    .findAll('button')
    .find(button => button.text() === 'Save')!
    .trigger('click')
  expect(wrapper.findComponent(MessageEditor).emitted('save')).toEqual([['hello']])
})
