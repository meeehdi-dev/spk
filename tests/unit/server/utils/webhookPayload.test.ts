import { describe, expect, test } from 'vitest'

import { extractMentionIds } from '#shared/utils/markdown'
import { formatPayload, sanitizeEmbed } from '~~/server/utils/webhookPayload'

const json = (v: unknown) => formatPayload('application/json', JSON.stringify(v))

describe('formatPayload', () => {
  test.each([
    [
      'discord',
      { content: 'hi', embeds: [{ title: 'T', description: 'D', color: 0xff0000, footer: { text: 'F' } }] },
      { body: 'hi', embed: { title: 'T', description: 'D', color: 'error', footer: 'F' } },
    ],
    [
      'slack',
      { text: 'hey', attachments: [{ title: 'T', text: 'D', color: 'good', fields: [{ title: 'a', value: 'b', short: true }] }] },
      { body: 'hey', embed: { title: 'T', description: 'D', color: 'success', fields: [{ name: 'a', value: 'b', inline: true }] } },
    ],
    ['slack hex color', { attachments: [{ text: 'D', color: '#36a64f' }] }, { body: '', embed: { description: 'D', color: 'success' } }],
    ['slack text only', { text: 'just text' }, { body: 'just text' }],
    [
      'coolify success',
      { event: 'deployment_success', message: 'App deployed\nmore', url: 'https://x.dev/a' },
      { body: '', embed: { title: 'deployment_success', description: 'App deployed\nmore', url: 'https://x.dev/a', color: 'success' } },
    ],
    ['coolify failure', { message: 'Deployment failed for app' }, { body: '', embed: { title: 'Deployment failed for app', color: 'error' } }],
    ['unhealthy is not success', { event: 'server_unhealthy', message: 'x' }, { embed: { color: 'error' } }],
    [
      'generic',
      { title: 'Hello', message: 'World', user: 'bob', n: 3 },
      {
        embed: {
          title: 'Hello',
          description: 'World',
          fields: [
            { name: 'user', value: 'bob', inline: true },
            { name: 'n', value: '3', inline: true },
          ],
        },
      },
    ],
  ])('%s', (_n, input, expected) => expect(json(input)).toMatchObject(expected))

  test('generic nested data goes into a json block', () => {
    expect(json({ title: 'T', data: { a: 1 } })?.embed?.description).toContain('```json')
  })
  test('generic fields are capped at 10', () => {
    const p = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i]))
    expect(json({ title: 'T', ...p })?.embed?.fields).toHaveLength(10)
  })
  test('text/plain is body only', () => expect(formatPayload('text/plain', ' hello ')).toEqual({ body: 'hello' }))
  test.each([
    ['application/json', '{nope'],
    ['application/json', ''],
    ['text/plain', '  '],
    ['application/json', 'null'],
    ['application/json', '{}'],
  ])('junk %s %j → null', (t, raw) => expect(formatPayload(t, raw)).toBeNull())
  test('oversized fields are truncated', () => {
    const e = json({ title: 'x'.repeat(1000), message: 'y'.repeat(9000) })!.embed!
    expect([e.title!.length, e.description!.length]).toEqual([256, 4096])
  })
  test('javascript: url is dropped', () => {
    expect(json({ title: 'T', url: 'javascript:alert(1)' })?.embed?.url).toBeUndefined()
    expect(json({ content: 'x', embeds: [{ title: 'T', url: 'javascript:alert(1)' }] })?.embed?.url).toBeUndefined()
  })
  test('mention syntax is stripped', () => {
    const r = json({ title: 'hi <@abc-1>', message: 'ping <@u2> now' })!
    expect(r.embed).toMatchObject({ title: 'hi', description: 'ping  now' })
  })
})

describe('mention stripping', () => {
  test('text/plain', () => expect(formatPayload('text/plain', 'hi <@abc>')).toEqual({ body: 'hi' }))
  test('bare JSON string', () => expect(json('hi <@abc>')).toEqual({ body: 'hi' }))
  test.each([
    ['text/plain', '<<@x>@abc>'],
    ['application/json', JSON.stringify({ text: 'a <<@x>@abc> b' })],
    ['application/json', JSON.stringify({ content: '<<@x>@abc>hi', embeds: [{ title: 't' }] })],
    ['application/json', JSON.stringify({ text: '<<@x>@abc>hi', attachments: [{ title: 't' }] })],
  ])('nested bypass in %s %s leaves no mention', (ct, raw) => {
    expect(extractMentionIds(formatPayload(ct, raw)!.body)).toEqual([])
  })
  test('crafted input stays linear', () => {
    const t0 = performance.now()
    formatPayload('text/plain', '<@'.repeat(32_000))
    formatPayload('text/plain', '<'.repeat(16_000) + '@x>'.repeat(16_000))
    expect(performance.now() - t0).toBeLessThan(100)
  })
})

describe('sanitizeEmbed', () => {
  test('caps fields and rejects unknown colors', () => {
    const e = sanitizeEmbed({ title: 'T', color: 'red', fields: Array.from({ length: 30 }, () => ({ name: 'n'.repeat(300), value: 'v'.repeat(2000) })) })!
    expect(e.color).toBeUndefined()
    expect(e.fields).toHaveLength(25)
    expect([e.fields![0]!.name.length, e.fields![0]!.value.length]).toEqual([256, 1024])
  })
  test('nothing usable → undefined', () => expect(sanitizeEmbed({ color: 'info' })).toBeUndefined())
})
