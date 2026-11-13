import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chatKeys, fenceLanguage, fixSpoilerSeams, Spoiler, SpkMention } from '~/utils/editor-extensions'

const names: Record<string, string> = { u1: 'Alex' }
function roundTrip(md: string) {
  const editor = new Editor({
    extensions: [
      Markdown.configure({ markedOptions: { gfm: true } }),
      StarterKit.configure({ underline: false }),
      SpkMention.configure({ getLabel: id => names[id] }),
      Spoiler,
    ],
    content: md,
    contentType: 'markdown',
  })
  return { out: fixSpoilerSeams(editor.getMarkdown()), json: editor.getJSON(), editor }
}

describe('editor markdown round trip', () => {
  it('mention <@id>', () => {
    const { out, json } = roundTrip('hi <@u1> there')
    expect(out).toBe('hi <@u1> there')
    expect(JSON.stringify(json)).toContain('"label":"Alex"')
  })
  it('spoiler ||x||', () => {
    expect(roundTrip('a ||secret|| b').out).toBe('a ||secret|| b')
  })
  it('spoiler around bold, mention in spoiler', () => {
    expect(roundTrip('||a **b** <@u1>||').out).toBe('||a **b** <@u1>||')
  })
  it('next to other formatting', () => {
    const md = '**bold** said ||*x*|| and `code` ~~gone~~ <@u1>'
    const once = roundTrip(md).out
    expect(roundTrip(once).out).toBe(once) // stable after one pass (mark nesting order may differ)
    expect(once).toContain('<@u1>')
    expect(once).toContain('||')
  })
  it('plain code block and quote', () => {
    const md = '```ts\nconst a = "||x||"\n```\n\n> quoted <@u1>'
    expect(roundTrip(md).out).toBe(md)
  })
  it('known limit: a spoiler holding only a mention keeps the mention but drops the spoiler', () => {
    expect(roundTrip('a ||<@u1>|| b').out).toBe('a <@u1> b')
  })
  it('unterminated || stays literal', () => {
    expect(roundTrip('a || b').out).toBe('a || b')
  })
})

function press(content: string, key = 'ArrowUp') {
  const onArrowUp = vi.fn(() => true)
  const editor = new Editor({
    extensions: [Markdown, StarterKit, chatKeys({ onEnter: () => {}, onArrowUp })],
    content,
    contentType: 'markdown',
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
    for (const e of made) e.destroy()
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

describe('chatKeys Enter in lists', () => {
  const setup = (content: string) => {
    const onEnter = vi.fn()
    const editor = new Editor({ extensions: [Markdown, StarterKit, chatKeys({ onEnter })], content, contentType: 'markdown' })
    editor.commands.focus('end')
    const enter = () => editor.view.someProp('handleKeyDown', f => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    return { onEnter, editor, enter }
  }
  it('continues a non-empty item without sending, and round-trips', () => {
    const { onEnter, editor, enter } = setup('- a')
    expect(enter()).toBe(true) // handled by the list keymap
    editor.commands.insertContent('b')
    expect(onEnter).not.toHaveBeenCalled()
    expect(editor.getMarkdown().trim()).toBe('- a\n- b')
    editor.destroy()
  })
  it('leaves the list on an empty item', () => {
    const { onEnter, editor, enter } = setup('- a')
    enter()
    enter()
    expect(onEnter).not.toHaveBeenCalled()
    expect(editor.isActive('bulletList')).toBe(false)
    editor.destroy()
  })
  it('turns "- " into a bullet item, and still sends outside lists', () => {
    const { onEnter, editor, enter } = setup('')
    const { view } = editor
    view.dispatch(view.state.tr.insertText('-'))
    view.someProp('handleTextInput', f => f(view, view.state.selection.from, view.state.selection.to, ' ', () => view.state.tr))
    expect(editor.isActive('bulletList')).toBe(true)
    editor.commands.setContent('hi', { contentType: 'markdown' })
    editor.commands.focus('end')
    enter()
    expect(onEnter).toHaveBeenCalled()
    editor.destroy()
  })
})
