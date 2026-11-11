// URL helpers shared by the server (preview jobs, hydrate) and the client (inline images).
import { parseInternalLink } from './markdown'

export const MAX_PREVIEWS = 3

/** `https://<any host>/….gif|png|jpg|jpeg|webp`: rendered inline, never given a preview card. */
export function isImageUrl(url: string): boolean {
  if (!/^\S+$/.test(url)) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /\.(gif|png|jpe?g|webp)$/i.test(u.pathname)
  } catch { return false }
}

const trimEnd = (s: string) => {
  for (;;) {
    const t = s.replace(/[.,;:!?*_~'"]+$/, '')
    const unbalanced = t.endsWith(')') && (t.match(/\)/g)!.length > (t.match(/\(/g) ?? []).length)
    if (unbalanced) {
      s = t.slice(0, -1)
      continue
    }
    return t
  }
}

/**
 * Distinct http(s) URLs in a message body, in order. Skipped: `<url>` (opts out), URLs in code or spoilers,
 * and links into this app (`origin`). Not capped: callers slice to MAX_PREVIEWS after their own filtering.
 */
export function extractUrls(body: string, origin?: string): string[] {
  const text = body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[`~]*[ \t]*$|$(?![\s\S]))/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\|\|[\s\S]*?\|\|/g, '')
  const out = new Set<string>()
  for (const m of text.matchAll(/(?<![<\w])https?:\/\/[^\s<>[\]]+/gi)) {
    try {
      const u = new URL(trimEnd(m[0]))
      if (!origin || !parseInternalLink(u.href, origin)) out.add(u.href)
    } catch { /* not a URL */ }
  }
  return [...out]
}

/** Message body from the typed text plus an optional staged GIF URL (on its own line after the text). */
export const composeBody = (text: string, gif?: string | null) => [text.trim(), gif].filter(Boolean).join('\n')
