// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { fixSpoilerSeams, Spoiler, SpkMention } from '../app/utils/editor-extensions'

const names: Record<string, string> = { u1: 'Alex' }
function roundTrip(md: string) {
  const editor = new Editor({
    extensions: [Markdown.configure({ markedOptions: { gfm: true } }), StarterKit.configure({ underline: false }), SpkMention.configure({ getLabel: id => names[id] }), Spoiler],
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
