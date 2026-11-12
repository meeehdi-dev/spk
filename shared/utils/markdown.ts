// Shared by the server (mention extraction) and the renderer (remark plugin + URL check).

export const MAX_BODY_BYTES = 200 * 1024

const MENTION_RE = /<@([\w-]+)>/g

/** Distinct user ids in `<@id>` tokens. Code spans and fenced code don't ping. */
export function extractMentionIds(body: string): string[] {
  const text = body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[`~]*[ \t]*$|$(?![\s\S]))/gm, '').replace(/`[^`\n]*`/g, '')
  return [...new Set([...text.matchAll(MENTION_RE)].map(m => m[1]!))]
}

/** Only http, https and mailto links are clickable. */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url, 'http://relative.invalid')
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) && !/^\s*\/\//.test(url) ? url : null
  } catch {
    return null
  }
}

interface Node {
  type: string
  value?: string
  children?: Node[]
  [k: string]: unknown
}

// One emoji: pictograph (+ variation selector, skin tone, ZWJ parts), regional-indicator flag, or keycap.
const EMOJI = String.raw`(?:\p{RI}\p{RI}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*)`
const EMOJI_SPLIT_RE = new RegExp(`(${EMOJI})`, 'gu')
const EMOJI_ONLY_RE = new RegExp(`^(?:${EMOJI}\\s*){1,6}$`, 'u')

/** 1–6 emoji and whitespace, nothing else: rendered large. */
export const isEmojiOnly = (body: string) => EMOJI_ONLY_RE.test(body.trim())

const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem'])

function splitText(value: string): Node[] {
  const out: Node[] = []
  const push = (v: string) => {
    for (const [i, part] of v.split(EMOJI_SPLIT_RE).entries()) {
      if (!part) continue
      // hChildren keeps the walker from splitting the emoji text again.
      out.push(
        i % 2
          ? { type: 'spkEmoji', data: { hName: 'span', hProperties: { className: ['emoji'] }, hChildren: [{ type: 'text', value: part }] } }
          : { type: 'text', value: part },
      )
    }
  }
  for (const [i, line] of value.split('\n').entries()) {
    if (i > 0) out.push({ type: 'break' })
    let last = 0
    for (const m of line.matchAll(/<@([\w-]+)>|\|\|/g)) {
      push(line.slice(last, m.index))
      out.push(m[1] ? { type: 'spkMention', data: { hName: 'mention-chip', hProperties: { uid: m[1] } } } : { type: 'spkMarker' })
      last = m.index + m[0].length
    }
    push(line.slice(last))
  }
  return out
}

/** Pair `||` markers inside one parent; unpaired ones go back to plain text. */
function pairSpoilers(nodes: Node[]): Node[] {
  const out: Node[] = []
  let open = -1
  for (const n of nodes) {
    if (n.type !== 'spkMarker') {
      out.push(n)
      continue
    }
    if (open < 0) {
      open = out.length
      out.push(n)
      continue
    }
    const inner = out.splice(open + 1)
    out.pop() // the opening marker
    if (inner.some(c => c.type !== 'text' || c.value?.trim())) {
      out.push({ type: 'spkSpoiler', children: inner, data: { hName: 'spoiler-text' } })
    } else {
      out.push({ type: 'text', value: '||' }, ...inner, { type: 'text', value: '||' })
    }
    open = -1
  }
  return out.map(n => (n.type === 'spkMarker' ? { type: 'text', value: '||' } : n))
}

function walk(parent: Node, src: string) {
  if (!parent.children) return
  const next: Node[] = []
  for (const c of parent.children) {
    if (c.type === 'html') {
      // Raw HTML is never rendered: show it as literal text.
      const t: Node = { type: 'text', value: c.value }
      next.push(BLOCK_PARENTS.has(parent.type) ? { type: 'paragraph', children: [t] } : t)
    } else if (c.type === 'image') {
      next.push({ type: 'link', url: c.url, children: [{ type: 'text', value: String(c.alt || c.url) }] })
    } else if (c.type === 'heading') {
      next.push({ type: 'paragraph', children: [{ type: 'strong', children: c.children }] })
    } else if (c.type === 'text') {
      next.push(...splitText(c.value!))
    } else {
      // `<url>` opts out of inline images and previews: mark it plain.
      const at = (c.position as { start?: { offset?: number } } | undefined)?.start?.offset
      if (c.type === 'link' && at != null && src[at] === '<') c.data = { ...(c.data as object), hProperties: { plain: true } }
      next.push(c)
    }
  }
  parent.children = pairSpoilers(next)
  parent.children.forEach(n => walk(n, src))
}

/** remark plugin: `<@id>` -> mention-chip, `||x||` -> spoiler-text, newlines -> <br>, HTML/images/headings -> text/links/bold. */
export function remarkSpk() {
  return (tree: Node, file: { value?: unknown }) => walk(tree, String(file?.value ?? ''))
}

export type InternalLink = { channelId: string; messageId?: string }

/** `https://<this app>/c/:channelId[/m/:messageId]` -> ids, else null. */
export function parseInternalLink(href: string, origin: string): InternalLink | null {
  try {
    const u = new URL(href)
    if (u.origin !== origin) return null
    const m = /^\/c\/([\w-]+)(?:\/m\/([\w-]+))?\/?$/.exec(u.pathname)
    return m ? { channelId: m[1]!, messageId: m[2] } : null
  } catch {
    return null
  }
}

/**
 * Rewrites the language of a fenced code block, found by its content: the `occurrence`-th (0-based, document
 * order) fenced block whose code equals `code`. Matching by content means indented code blocks (rendered but
 * not fenced) can never point at the wrong block. Returns null when no such block exists.
 */
export function setFenceLanguage(body: string, occurrence: number, lang: string, code: string): string | null {
  const lines = body.split('\n')
  const quote = /^(?:[ \t]*>)*[ \t]?/
  let seen = -1
  let open: { ch: string; len: number; at: number; prefix: string; mark: string; info: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})(.*)$/.exec(lines[i]!)
    if (!open) {
      if (!m || (m[2]![0] === '`' && m[3]!.includes('`'))) continue // not a fence (or inline code)
      open = { ch: m[2]![0]!, len: m[2]!.length, at: i, prefix: m[1]!, mark: m[2]!, info: m[3]! }
    } else if (m && m[2]![0] === open.ch && m[2]!.length >= open.len && !m[3]!.trim()) {
      const inner = lines
        .slice(open.at + 1, i)
        .map(l => l.replace(quote, ''))
        .join('\n')
      if (inner === code && ++seen === occurrence) {
        lines[open.at] = open.prefix + open.mark + open.info.replace(/^\s*\S*/, lang)
        return lines.join('\n')
      }
      open = null
    }
  }
  return null
}
