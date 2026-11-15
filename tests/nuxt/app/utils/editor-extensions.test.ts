import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { chatKeys, chatMarkExtensions, fenceLanguage, fixSpoilerSeams, Spoiler, SpkMention } from '~/utils/editor-extensions'

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

describe('editable Twemoji', () => {
  const made: Editor[] = []
  let artwork: HTMLImageElement[] = []
  beforeEach(() => {
    artwork = []
    vi.stubGlobal('Image', function () {
      const image = document.createElement('img')
      artwork.push(image)
      return image
    })
  })
  const loadArtwork = () => {
    for (const image of artwork) image.dispatchEvent(new Event('load'))
  }
  const glyphs = (editor: Editor) => [...editor.view.dom.querySelectorAll('[data-emoji]')].map(span => span.getAttribute('data-emoji'))
  const setup = (content: string, getLabel = (_id: string) => 'Alex 😀', loaded = true) => {
    const editor = new Editor({
      extensions: [Markdown, StarterKit, ...chatMarkExtensions(getLabel)],
      content,
      contentType: 'markdown',
    })
    made.push(editor)
    if (loaded) loadArtwork()
    return editor
  }
  afterEach(() => {
    for (const editor of made) editor.destroy()
    made.length = 0
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('paints complete emoji sequences without changing text, JSON, HTML or markdown', () => {
    const text = 'hi 😀👩🏽‍💻 🇫🇷 1️⃣ ❤️ end'
    const editor = setup(text)
    expect(glyphs(editor)).toEqual(['😀', '👩🏽‍💻', '🇫🇷', '1️⃣', '❤️'])
    for (const span of editor.view.dom.querySelectorAll<HTMLElement>('[data-emoji]')) {
      expect(span.textContent).toBe(span.dataset.emoji)
      expect(span.style.backgroundImage).toMatch(/\/twemoji\/.+\.svg/)
      expect(span.style.display).toBe('inline-block')
      expect(span.style.width).toBe('1em')
      expect(span.style.position).toBe('')
    }
    expect(editor.view.dom.querySelector('.ProseMirror-widget')).toBeNull()
    expect(editor.state.doc.textContent).toBe(text)
    expect(editor.getJSON().content?.[0]?.content).toEqual([{ type: 'text', text }])
    expect(editor.getMarkdown()).toBe(text)
    expect(editor.getHTML()).toBe(`<p>${text}</p>`)
  })

  it('leaves inline code and code blocks untouched, including after changing marks', () => {
    const editor = setup('😀 **❤️** ||🔥|| `👩🏽‍💻`\n\n```text\n🇫🇷\n```')
    expect(glyphs(editor)).toEqual(['😀', '❤️', '🔥'])
    expect(editor.view.dom.querySelector('[data-spoiler] [data-emoji]')?.textContent).toBe('🔥')
    expect(editor.view.dom.querySelector('strong [data-emoji]')?.textContent).toBe('❤️')
    expect(editor.view.dom.querySelectorAll('code [data-emoji]')).toHaveLength(0)
    expect(editor.view.dom.querySelector('code')?.textContent).toBe('👩🏽‍💻')
    editor.commands.setContent('😀', { contentType: 'markdown' })
    editor.chain().selectAll().toggleCode().run()
    expect(glyphs(editor)).toEqual([])
    editor.commands.toggleCode()
    expect(glyphs(editor)).toEqual(['😀'])
  })

  it('retains text positions and copies Unicode, not decoration markup', () => {
    const emoji = '👩🏽‍💻'
    const editor = setup(`a${emoji}b`)
    const from = 2
    const to = from + emoji.length
    for (const pos of [from, from + 2, to]) {
      const dom = editor.view.domAtPos(pos)
      expect(editor.view.posAtDOM(dom.node, dom.offset)).toBe(pos)
    }
    const span = editor.view.dom.querySelector('[data-emoji]')
    editor.commands.setTextSelection({ from, to })
    expect(editor.view.dom.querySelector('[data-emoji]')).toBe(span)
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe(emoji)
    const clipboard = editor.view.serializeForClipboard(editor.state.selection.content())
    expect(clipboard.text).toBe(emoji)
    expect(clipboard.dom.textContent).toBe(emoji)
    expect(clipboard.dom.querySelector('img')).toBeNull()
    editor.commands.insertContent('❤️')
    expect(editor.getMarkdown()).toBe('a❤️b')
    loadArtwork()
    expect(glyphs(editor)).toEqual(['❤️'])
    editor.commands.undo()
    expect(editor.getMarkdown()).toBe(`a${emoji}b`)
    editor.commands.setTextSelection({ from, to })
    editor.commands.deleteSelection()
    expect(editor.getMarkdown()).toBe('ab')
    expect(glyphs(editor)).toEqual([])
  })

  it('keeps Unicode visible while artwork loads or fails and cleans up pending loads', () => {
    const editor = setup('😀', undefined, false)
    expect(glyphs(editor)).toEqual([])
    expect(editor.view.dom.textContent).toBe('😀')
    artwork[0]!.dispatchEvent(new Event('error'))
    expect(glyphs(editor)).toEqual([])
    expect(editor.view.dom.querySelector('[style*="transparent"]')).toBeNull()
    editor.commands.insertContent('❤️')
    artwork[1]!.dispatchEvent(new Event('load'))
    expect(glyphs(editor)).toEqual(['❤️'])
    editor.destroy()
    expect(artwork.every(image => image.onload === null)).toBe(true)
    made.length = 0
  })

  it('renders mention labels with fallback while retaining mention serialization and updates', async () => {
    const editor = setup('hi <@u1>')
    expect(editor.view.dom.querySelector('.mention img')?.getAttribute('alt')).toBe('😀')
    expect(editor.getMarkdown()).toBe('hi <@u1>')
    expect(editor.getText()).toBe('hi @Alex 😀')
    expect(editor.getHTML()).not.toContain('<img')
    const image = editor.view.dom.querySelector('.mention img')!
    image.dispatchEvent(new Event('error'))
    await nextTick()
    expect(editor.view.dom.querySelector('.mention')?.textContent).toBe('@Alex 😀')
    editor.commands.setTextSelection({ from: 4, to: 5 })
    editor.commands.updateAttributes('mention', { label: 'Sam ❤️' })
    await nextTick()
    expect(editor.view.dom.querySelector('.mention img')?.getAttribute('alt')).toBe('❤️')
    expect(editor.getMarkdown()).toBe('hi <@u1>')
  })
})

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
