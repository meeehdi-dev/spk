export interface GifItem { id: string, title: string, url: string, preview: string, width: number, height: number }

interface Fmt { url?: string, width?: number, height?: number }

/** Klipy's page of GIFs -> what the menu needs. URLs are passed through unchanged; order is kept. */
export function mapGifs(json: unknown): { items: GifItem[], hasNext: boolean } {
  const data = (json as { data?: { data?: Array<{ id?: unknown, slug?: unknown, title?: unknown, file?: { md?: { gif?: Fmt }, sm?: { webp?: Fmt, gif?: Fmt } } }>, has_next?: unknown } } | null)?.data
  const items: GifItem[] = []
  for (const g of Array.isArray(data?.data) ? data.data : []) {
    const md: Fmt | undefined = g?.file?.md?.gif, sm: Fmt | undefined = g?.file?.sm?.webp ?? g?.file?.sm?.gif ?? md
    if (!md?.url || !sm?.url) continue // ads and other non-GIF entries have no file formats
    items.push({ id: String(g.id ?? g.slug), title: String(g.title ?? ''), url: md.url, preview: sm.url, width: md.width ?? 0, height: md.height ?? 0 })
  }
  return { items, hasNext: !!data?.has_next }
}
