import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'

import { createParseProcessor } from '@nuxtjs/mdc/runtime'
import { describe, expect, it } from 'vitest'

import { extractMentionIds, isEmojiOnly, remarkSpk, safeHref, setFenceLanguage } from '#shared/utils/markdown'

async function parse(md: string) {
  const p = await createParseProcessor({ remark: { plugins: { 'remark-mdc': false as never, spk: { instance: remarkSpk } } }, highlight: false, toc: false })
  return ((await p.process({ value: md })).result as { body: MDCRoot }).body
}
const tags = (n: MDCNode | MDCRoot): string[] =>
  n.type === 'element' ? [n.tag, ...n.children.flatMap(tags)] : ('children' in n ? n.children : []).flatMap(tags)
const text = (n: MDCNode | MDCRoot): string => (n.type === 'text' ? n.value : ('children' in n ? n.children : []).map(text).join(''))

describe('extractMentionIds', () => {
  it('finds distinct ids, ignores code', () => {
    expect(extractMentionIds('hi <@a> and <@b> <@a>')).toEqual(['a', 'b'])
    expect(extractMentionIds('`<@a>` ok')).toEqual([])
    expect(extractMentionIds('```\n<@a>\n```\n<@b>')).toEqual(['b'])
  })
})

describe('safeHref', () => {
  it('allows only http, https, mailto', () => {
    expect(safeHref('https://a.dev')).toBe('https://a.dev')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
  })
})

describe('remarkSpk', () => {
  it('turns <@id> and ||x|| into nodes, html into text', () => {
    const tree: Parameters<ReturnType<typeof remarkSpk>>[0] = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'a <@u1> ||sec|| ||open' }] },
        { type: 'html', value: '<img src=x onerror=1>' },
      ],
    }
    remarkSpk()(tree, {})
    const kids = tree.children![0]!.children!
    expect(kids.map(k => k.type)).toEqual(['text', 'spkMention', 'text', 'spkSpoiler', 'text', 'text', 'text'])
    expect(kids[1]!.data).toMatchObject({ hProperties: { uid: 'u1' } })
    expect(tree.children![1]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '<img src=x onerror=1>' }] })
  })
})

describe('chat markdown rendering', () => {
  it('<url> is marked plain; a bare url is not', async () => {
    const j = JSON.stringify(await parse('<https://a.example/x.gif>\n\nhttps://b.example/y.gif'))
    expect(j.match(/"plain":""/g)).toHaveLength(1)
  })
  it('mention and spoiler become components, keeping formatting around them', async () => {
    const body = await parse('hi <@u1> **b** ||*x* <@u2>||')
    const t = tags(body)
    expect(t).toContain('mention-chip')
    expect(t).toContain('spoiler-text')
    expect(t).toContain('strong')
    expect(JSON.stringify(body)).toContain('"uid":"u1"')
  })
  it('hard breaks and newlines render as one <br> with no extra newline text', async () => {
    for (const md of ['a  \nb', 'a\nb']) {
      const body = await parse(md)
      expect(tags(body)).toEqual(['p', 'br'])
      expect(text(body)).toBe('ab')
    }
    expect(tags(await parse('a\n\nb'))).toEqual(['p', 'p'])
  })
  it('raw HTML is shown as text, never as elements', async () => {
    const body = await parse('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n<div onclick=1>hi</div>')
    expect(tags(body).filter(t => !['p', 'br'].includes(t))).toEqual([])
    expect(text(body)).toContain('<script>')
  })
  it('code fences keep language and raw code; || inside code stays literal', async () => {
    const body = await parse('```ts\nconst a = "||x||"\n```')
    const pre = body.children.find((c): c is MDCElement => c.type === 'element' && c.tag === 'pre')!
    expect(pre.props!.language).toBe('ts')
    expect(pre.props!.code).toContain('||x||')
    expect(tags(body)).not.toContain('spoiler-text')
  })
  it('keeps newlines as line breaks and autolinks', async () => {
    const body = await parse('a\nb https://example.com')
    expect(tags(body)).toContain('br')
    expect(tags(body)).toContain('a')
  })
  it('lists, quotes, headings flatten sanely', async () => {
    const t = tags(await parse('# h\n\n- a\n- b\n\n> q'))
    expect(t).toContain('ul')
    expect(t).toContain('blockquote')
    expect(t).not.toContain('h1')
  })
  it('wraps emoji in a span, leaving other text alone', async () => {
    const body = await parse('hi 👍🏽 and 🇫🇷 ok 12')
    expect(JSON.stringify(body).match(/"emoji"/g)).toHaveLength(2)
    expect(text(body)).toBe('hi 👍🏽 and 🇫🇷 ok 12')
  })
})

describe('isEmojiOnly', () => {
  it('1–6 emoji with whitespace only', () => {
    for (const ok of ['😀', ' 😀 😀\n👍🏽 ', '👨‍👩‍👧🇫🇷1️⃣❤️']) expect(isEmojiOnly(ok)).toBe(true)
    for (const no of ['', 'a😀', '😀 1', '😀😀😀😀😀😀😀', '12', '**😀**']) expect(isEmojiOnly(no)).toBe(false)
  })
})

describe('setFenceLanguage', () => {
  const body = 'a\n```\none\n```\n\n    indented\n\n```ts\ntwo\n```\n> ```py\n> q\n> ```\n```\none\n```'
  it('rewrites the fenced block with that code (Nth of identical ones)', () => {
    expect(setFenceLanguage(body, 0, 'js', 'one')).toBe(body.replace('```\none', '```js\none'))
    expect(setFenceLanguage(body, 1, 'js', 'one')!.endsWith('```js\none\n```')).toBe(true)
    expect(setFenceLanguage(body, 0, 'js', 'two')).toBe(body.replace('```ts', '```js'))
    expect(setFenceLanguage(body, 0, 'js', 'q')).toContain('> ```js\n> q')
    expect(setFenceLanguage(body, 0, 'js', 'indented')).toBeNull()
    expect(setFenceLanguage(body, 2, 'js', 'one')).toBeNull()
  })
  it('handles longer fences and a fence inside another', () => {
    const b = '````md\n```\nx\n```\n````'
    expect(setFenceLanguage(b, 0, 'text', '```\nx\n```')).toBe('````text\n```\nx\n```\n````')
    expect(setFenceLanguage(b, 0, 'text', 'x')).toBeNull()
  })
})
