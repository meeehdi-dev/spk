import { Readable } from 'node:stream'

import { afterEach, describe, expect, vi } from 'vitest'

import { messages } from '~~/server/db/schema'
import { createWebhook } from '~~/server/db/webhooks'
import { addUser, test } from '~~/tests/fixtures/db'
import { stubNitro } from '~~/tests/fixtures/nitro'

let id: string, secret: string, ip: string
let ctype: string, clen: string | undefined, raw: string | null, chunks: string[] | null
const publishMessage = vi.fn()
type H = (event: never) => Promise<unknown>
let post: H, params: Record<string, string>

const status = (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e: { statusCode: number }) => e.statusCode,
  )

test.beforeEach(async ({ db }) => {
  vi.resetModules()
  publishMessage.mockReset()
  addUser(db, 'a')
  ;({
    channel: { id },
    secret,
  } = createWebhook(db, 'a', { name: 'x', icon: 'bell' }))
  params = { id, secret }
  ip = '1.1.1.1'
  ctype = 'application/json'
  clen = undefined
  chunks = null
  raw = JSON.stringify({ title: 'Deployed', message: 'ok' })
  stubNitro({
    useDb: () => db,
    getRouterParam: (_e: unknown, k: string) => params[k],
    getRequestIP: () => ip,
    getRequestHeader: (_e: unknown, k: string) => (k === 'content-length' ? clen : ctype),
    setResponseStatus: vi.fn(),
    publishMessage,
  })
  const handler = (await import('~~/server/api/hooks/[id]/[secret].post')).default as unknown as H
  // The request stream is the raw body (or the explicit chunks, sent without content-length).
  post = () => handler({ node: { req: Readable.from((chunks ?? [raw ?? '']).map(c => Buffer.from(c))) } } as never)
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/hooks/:id/:secret', () => {
  test('204, stores as owner with embed and publishes without sender or previews', async ({ db }) => {
    expect(await post({} as never)).toBeNull()
    expect(db.select().from(messages).all()).toMatchObject([{ userId: 'a', channelId: id, embed: { title: 'Deployed', description: 'ok' } }])
    expect(publishMessage).toHaveBeenCalledWith(expect.objectContaining({ channelId: id }), { previews: false })
  })
  test('bad id or bad secret → 404', async () => {
    params = { id, secret: 'nope' }
    expect(await status(post({} as never))).toBe(404)
    params = { id: 'nope', secret }
    expect(await status(post({} as never))).toBe(404)
    expect(publishMessage).not.toHaveBeenCalled()
  })
  test('21st failed attempt from one IP → 429', async () => {
    params = { id, secret: 'nope' }
    const codes = []
    for (let i = 0; i < 21; i++) codes.push(await status(post({} as never)))
    expect(codes.slice(0, 20).every(c => c === 404)).toBe(true)
    expect(codes[20]).toBe(429)
  })
  test('content-length over 64 KB → 413 without reading', async () => {
    clen = String(64 * 1024 + 1)
    raw = null
    expect(await status(post({} as never))).toBe(413)
  })
  test('raw body over 64 KB → 413', async () => {
    raw = 'x'.repeat(64 * 1024 + 1)
    ctype = 'text/plain'
    expect(await status(post({} as never))).toBe(413)
  })
  test('chunked body without content-length over 64 KB → 413', async () => {
    ctype = 'text/plain'
    chunks = Array.from({ length: 5 }, () => 'x'.repeat(16 * 1024))
    expect(await status(post({} as never))).toBe(413)
  })
  test.each([['{nope'], ['']])('unparseable %j → 400', async body => {
    raw = body
    expect(await status(post({} as never))).toBe(400)
  })
  test('31st post per webhook → 429', async () => {
    const codes = []
    for (let i = 0; i < 31; i++) codes.push(await status(post({} as never)))
    expect(codes.slice(0, 30).every(c => c === 0)).toBe(true)
    expect(codes[30]).toBe(429)
  })
})
