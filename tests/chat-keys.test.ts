// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chatKeys, fenceLanguage } from '../app/utils/editor-extensions'

function press(content: string, key = 'ArrowUp') {
  const onArrowUp = vi.fn(() => true)
  const editor = new Editor({
    extensions: [Markdown, StarterKit, chatKeys({ onEnter: () => {}, onArrowUp })],
    content, contentType: 'markdown',
  })
  const handled = editor.view.someProp('handleKeyDown', f => f(editor.view, new KeyboardEvent('keydown', { key })))
  editor.destroy()
  return { handled, onArrowUp, editor }
}

describe('chatKeys ArrowUp', () => {
  it('fires in an empty input', () => {
    const r = press('')
    expect(r.editor.isEmpty).toBe(true)
    expect(r.onArrowUp).toHaveBeenCalled()
  })
  it('does not fire with text', () => {
    expect(press('hi').onArrowUp).not.toHaveBeenCalled()
  })
})

describe('fenceLanguage', () => {
  it('matches a bare fence and a fence with a language', () => {
    expect(fenceLanguage('```')).toBe('')
    expect(fenceLanguage('```json')).toBe('json')
    expect(fenceLanguage('```c++')).toBe('c++')
  })
  it('rejects anything else', () => {
    for (const s of ['', 'hi', '``', '```json x', ' ```', 'a```', '````']) expect(fenceLanguage(s)).toBeNull()
  })
})

describe('chatKeys Enter on a fence line', () => {
  const made: Editor[] = []
  const run = (content: string) => {
    const onEnter = vi.fn()
    const editor = new Editor({ extensions: [Markdown, StarterKit, chatKeys({ onEnter })], content: '' })
    made.push(editor)
    editor.commands.insertContent(content)
    editor.view.someProp('handleKeyDown', f => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    return { onEnter, editor }
  }
  afterEach(() => {
    for (const e of made)
      e.destroy()
    made.length = 0
  })
  it('turns ```json into a json code block instead of sending', () => {
    const { onEnter, editor } = run('```json')
    expect(onEnter).not.toHaveBeenCalled()
    expect(editor.isActive('codeBlock', { language: 'json' })).toBe(true)
    expect(editor.state.doc.textContent).toBe('')
  })
  it('also works after a Shift+Enter line, keeping the earlier text', () => {
    const onEnter = vi.fn()
    const editor = new Editor({ extensions: [Markdown, StarterKit, chatKeys({ onEnter })], content: '' })
    made.push(editor)
    editor.chain().insertContent('here:').setHardBreak().insertContent('```json').run()
    editor.view.someProp('handleKeyDown', f => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onEnter).not.toHaveBeenCalled()
    expect(editor.isActive('codeBlock', { language: 'json' })).toBe(true)
    expect(editor.state.doc.firstChild?.textContent).toBe('here:')
    expect(editor.state.doc.child(1).type.name).toBe('codeBlock') // [text, code block, trailing paragraph]
  })
  it('sends on ordinary text', () => {
    expect(run('hello').onEnter).toHaveBeenCalled()
  })
})
