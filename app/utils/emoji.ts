import dataUrl from 'emoji-picker-element-data/en/emojibase/data.json?url'

// The picker's data is bundled with the app (no CDN request).
export const emojiDataUrl = () => new URL(dataUrl, location.href).href

export const QUICK_REACTIONS = ['👍', '❤️', '😂']

interface EmojiItem { name: string, emoji: string, shortcodes: string[], tags: string[] }
let items: Promise<EmojiItem[]> | undefined

/** Emoji for `:shortcode:` autocomplete (default yellow tone only). */
export function loadEmojiItems() {
  return items ??= fetch(emojiDataUrl()).then(r => r.json()).then((rows: Array<{ annotation: string, emoji: string, shortcodes?: string[], tags?: string[] }>) =>
    rows.map(r => ({ name: r.annotation, emoji: r.emoji, shortcodes: r.shortcodes ?? [], tags: r.tags ?? [] })))
}

/** Reply preview text: mentions as names, spoilers hidden. */
export const previewText = (raw: string, nameOf: (id: string) => string) =>
  raw.replace(/\|\|[^|]*\|\|/g, '▒▒▒').replace(/<@([\w-]+)>/g, (_, id) => `@${nameOf(id)}`)
