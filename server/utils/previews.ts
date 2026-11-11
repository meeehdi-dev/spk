import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'
import ogs from 'open-graph-scraper'
import sharp from 'sharp'

import { extractUrls, isImageUrl, MAX_PREVIEWS } from '../../shared/utils/links'
import { attachPreviews, cachedPreview, savePreview, type ParsedPreview } from '../db/previews'
import { messages } from '../db/schema'

import { appOrigin } from './appOrigin'
import { logBackground } from './errorLog'
import { createLimiter } from './limiter'
import { safeFetch } from './ssrf'

const allowFetch = createLimiter(20, 60_000) // page fetches per user per minute
const THUMB_WIDTH = 320
const MAX_IMAGE_BYTES = 3 * 1024 * 1024

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

/** Title, description, site name and image URL (absolute) from fetched HTML. Pure. */
export async function parseHtml(html: string, pageUrl: string) {
  const { result } = await ogs({ html })
  let image: string | null = null
  try {
    image = result.ogImage?.[0]?.url ? new URL(result.ogImage[0].url, pageUrl).href : null
  } catch {
    /* bad image URL */
  }
  return {
    title: clip(result.ogTitle ?? result.twitterTitle, 200),
    description: clip(result.ogDescription ?? result.twitterDescription, 400),
    siteName: clip(result.ogSiteName, 100),
    image,
  }
}

async function fetchOne(url: string): Promise<ParsedPreview> {
  const page = await safeFetch(url, { accept: 'html' })
  const p = await parseHtml(page.body.toString('utf8'), page.url)
  let imageKey: string | null = null
  if (p.image && (p.title || p.description)) {
    try {
      const img = await safeFetch(p.image, { accept: 'image', maxBytes: MAX_IMAGE_BYTES })
      const webp = await sharp(img.body, { limitInputPixels: 50_000_000 }).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp().toBuffer()
      imageKey = `previews/${createHash('sha256').update(url).digest('hex').slice(0, 32)}.webp`
      await r2Put(useR2(), imageKey, webp, 'image/webp')
    } catch {
      imageKey = null
    } // a card without a picture is fine
  }
  return { title: p.title, description: p.description, siteName: p.siteName, imageKey }
}

/** Background job after a send or edit: up to 3 links, cached, then a `message:previews` event. Never throws. */
export function queuePreviews(message: { id: string; channelId: string; userId: string; body: string }) {
  const urls = extractUrls(message.body, appOrigin())
    .filter(u => !isImageUrl(u))
    .slice(0, MAX_PREVIEWS)
  if (!urls.length) return
  void (async () => {
    const db = useDb()
    const row = db.select({ s: messages.suppressPreviews }).from(messages).where(eq(messages.id, message.id)).get()
    if (!row || row.s) return
    const ready: string[] = []
    for (const url of urls) {
      let p = cachedPreview(db, url)
      if (!p) {
        if (!allowFetch(message.userId)) continue
        try {
          savePreview(db, url, await fetchOne(url))
        } catch (e) {
          console.error(`[error] preview fetch failed: ${(e as Error).message}`)
          continue
        } // failures aren't cached: the link may work next time
        p = cachedPreview(db, url)
      }
      if (p?.title || p?.description) ready.push(url)
    }
    const updated = attachPreviews(db, message.id, ready)
    if (updated)
      fanOut(
        message.channelId,
        message.userId,
        { type: 'message:previews', channelId: message.channelId, messageId: message.id, previews: updated.previews },
        true,
      )
  })().catch(e => logBackground('previews', e))
}
