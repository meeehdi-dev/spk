import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'

import { createParseProcessor } from '@nuxtjs/mdc/runtime'
import { describe, expect, it } from 'vitest'

import { remarkSpk } from '../shared/utils/markdown'

async function parse(md: string) {
  const p = await createParseProcessor({ remark: { plugins: { 'remark-mdc': false as never, spk: { instance: remarkSpk } } }, highlight: false, toc: false })
  return ((await p.process({ value: md })).result as { body: MDCRoot }).body
}
const tags = (n: MDCNode | MDCRoot): string[] =>
  n.type === 'element' ? [n.tag, ...n.children.flatMap(tags)] : ('children' in n ? n.children : []).flatMap(tags)
const text = (n: MDCNode | MDCRoot): string => (n.type === 'text' ? n.value : ('children' in n ? n.children : []).map(text).join(''))

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
})
