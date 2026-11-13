import { describe, expect } from 'vitest'

import { createMessage, deleteMessage, editMessage, listMessages } from '~~/server/db/messages'
import { attachPreviews, cachedPreview, previewImageKey, removePreview, savePreview } from '~~/server/db/previews'
import { addUser, seedChat, test } from '~~/tests/fixtures/db'

const card = { title: 'T', description: 'D', siteName: 'S', imageKey: 'previews/k.webp' }

test.beforeEach(({ db }) => {
  seedChat(db)
  addUser(db, 'admin')
})

describe('preview storage', () => {
  test('caches by url with a TTL and shows cards on the message in order', ({ db }) => {
    const m = createMessage(db, 'a', 't', 'https://x.example https://y.example/')
    savePreview(db, 'https://y.example/', card, 1000)
    savePreview(db, 'https://x.example/', { ...card, imageKey: null }, 1000)
    expect(cachedPreview(db, 'https://x.example/', 1000 + 1000)).toBeTruthy()
    expect(cachedPreview(db, 'https://x.example/', 1000 + 8 * 24 * 3600_000)).toBeUndefined()
    const updated = attachPreviews(db, m.id, ['https://x.example/', 'https://y.example/'])!
    expect(updated.previews.map(p => [p.url, p.image])).toEqual([
      ['https://x.example/', false],
      ['https://y.example/', true],
    ])
    expect(listMessages(db, 't', {}).messages[0]!.previews.length).toBe(2)
    expect(attachPreviews(db, m.id, ['https://x.example/'])).toBeNull() // nothing new
  })

  test('only the author or an admin removes a card, and it stays removed', ({ db }) => {
    const m = createMessage(db, 'a', 't', 'https://x.example/')
    savePreview(db, 'https://x.example/', card)
    attachPreviews(db, m.id, ['https://x.example/'])
    expect(() => removePreview(db, 'b', false, m.id, 'https://x.example/')).toThrow(/author or an admin/)
    expect(removePreview(db, 'admin', true, m.id, 'https://x.example/').previews).toEqual([])
    expect(attachPreviews(db, m.id, ['https://x.example/'])).toBeNull() // a later job can't bring it back
  })

  test('editing away a link drops its card; deleting drops them all', ({ db }) => {
    const m = createMessage(db, 'a', 't', 'https://x.example/ https://y.example/')
    for (const u of ['https://x.example/', 'https://y.example/']) savePreview(db, u, card)
    attachPreviews(db, m.id, ['https://x.example/', 'https://y.example/'])
    expect(editMessage(db, 'a', m.id, 'only https://y.example/').previews.map(p => p.url)).toEqual(['https://y.example/'])
    deleteMessage(db, 'a', false, m.id)
    expect(attachPreviews(db, m.id, ['https://y.example/'])).toBeNull()
  })

  test.for([
    'removed',
    'https://replacement.example/',
    '<https://x.example/>',
    '`https://x.example/`',
    '```\nhttps://x.example/\n```',
    '||https://x.example/||',
    'https://a.example/ https://b.example/ https://c.example/ https://x.example/',
  ])('rejects delayed completion after editing to %s', (body, { db }) => {
    const m = createMessage(db, 'a', 't', 'https://x.example/')
    editMessage(db, 'a', m.id, body)
    savePreview(db, 'https://x.example/', card)
    expect(attachPreviews(db, m.id, ['https://x.example/'])).toBeNull()
    expect(listMessages(db, 't', {}).messages[0]!.previews).toEqual([])
  })

  test('attaches the replacement link after rejecting the old result', ({ db }) => {
    const m = createMessage(db, 'a', 't', 'https://x.example/')
    editMessage(db, 'a', m.id, 'https://y.example/')
    savePreview(db, 'https://x.example/', card)
    expect(attachPreviews(db, m.id, ['https://x.example/'])).toBeNull()
    savePreview(db, 'https://y.example/', card)
    expect(attachPreviews(db, m.id, ['https://y.example/'])!.previews.map(p => p.url)).toEqual(['https://y.example/'])
  })

  test('keeps eligible delayed links in current body order', ({ db }) => {
    const urls = ['https://x.example/', 'https://y.example/', 'https://z.example/']
    const m = createMessage(db, 'a', 't', urls.join(' '))
    editMessage(db, 'a', m.id, 'https://z.example/ https://y.example/')
    for (const url of urls) savePreview(db, url, card)
    expect(attachPreviews(db, m.id, urls)!.previews.map(p => p.url)).toEqual(['https://z.example/', 'https://y.example/'])
    expect(listMessages(db, 't', {}).messages[0]!.previews.map(p => p.url)).toEqual(['https://z.example/', 'https://y.example/'])
  })

  test.for(['deleted', 'suppressed'])('rejects delayed completion when the message is %s', (state, { db }) => {
    const m = createMessage(db, 'a', 't', 'https://x.example/')
    if (state === 'deleted') deleteMessage(db, 'a', false, m.id)
    else removePreview(db, 'a', false, m.id, 'https://x.example/')
    savePreview(db, 'https://x.example/', card)
    expect(attachPreviews(db, m.id, ['https://x.example/'])).toBeNull()
    expect(previewImageKey(db, 'a', m.id, 'https://x.example/')).toBeNull()
  })

  test('thumbnails are served only to readers of the message', ({ db }) => {
    const m = createMessage(db, 'a', 'dm', 'https://x.example/')
    savePreview(db, 'https://x.example/', card)
    attachPreviews(db, m.id, ['https://x.example/'])
    expect(previewImageKey(db, 'b', m.id, 'https://x.example/')).toBe('previews/k.webp')
    expect(previewImageKey(db, 'c', m.id, 'https://x.example/')).toBeNull()
    expect(previewImageKey(db, 'b', m.id, 'https://other.example')).toBeNull()
  })
})
