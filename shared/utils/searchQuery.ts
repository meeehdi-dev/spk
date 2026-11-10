// Search box syntax (PLAN.md §7), shared by the server (query building) and the client (autocomplete).
export const FILTER_KEYS = ['from', 'mentions', 'in', 'has', 'before', 'after'] as const
export type FilterKey = typeof FILTER_KEYS[number]
export const HAS_VALUES = ['file', 'image', 'link'] as const
export const MAX_TERMS = 8

export interface ParsedSearch {
  /** Plain words (prefix-matched). */
  terms: string[]
  from: string[], mentions: string[], in: string[]
  has: Array<typeof HAS_VALUES[number]>
  /** Day boundaries as ms (UTC midnight); `before` = older than that day, `after` = newer than the end of that day. */
  before?: number, after?: number
}

const DAY = 86_400_000

/** `YYYY-MM-DD` -> UTC midnight in ms, or null when it isn't a real date. */
export function parseDay(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const t = Date.parse(`${v}T00:00:00Z`)
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : t
}

// `key:value`, `key:"value with spaces"`, `"quoted words"`, or a bare word.
const TOKEN = /([a-z]+):(?:"([^"]*)"|(\S*))|"([^"]*)"|(\S+)/gi

/** Splits the search box text into filters and plain words. Unknown `key:` tokens and invalid has/date values stay plain words. */
export function parseSearch(q: string): ParsedSearch {
  const out: ParsedSearch = { terms: [], from: [], mentions: [], in: [], has: [] }
  for (const m of q.matchAll(TOKEN)) {
    const key = m[1]?.toLowerCase() as FilterKey | undefined
    if (key && (FILTER_KEYS as readonly string[]).includes(key)) {
      const value = (m[2] ?? m[3] ?? '').trim()
      if (!value) continue // still being typed
      if (key === 'has') {
        const v = value.toLowerCase() as typeof HAS_VALUES[number]
        if ((HAS_VALUES as readonly string[]).includes(v)) { if (!out.has.includes(v)) out.has.push(v); continue }
      } else if (key === 'before' || key === 'after') {
        const day = parseDay(value)
        if (day !== null) { if (key === 'before') out.before = day; else out.after = day + DAY; continue }
      } else {
        out[key].push(value.replace(/^[@#]/, ''))
        continue
      }
    }
    for (const w of (m[4] ?? m[0]).split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w) && out.terms.length < MAX_TERMS) out.terms.push(w.slice(0, 64))
  }
  return out
}

export const hasAnything = (p: ParsedSearch) =>
  !!(p.terms.length || p.from.length || p.mentions.length || p.in.length || p.has.length || p.before !== undefined || p.after !== undefined)

/** The filter token being typed at the end of the box (`from:Al`), for autocomplete. */
export function activeFilter(q: string): { key: FilterKey, value: string, start: number } | null {
  const m = /(?:^|\s)(from|mentions|in|has):([^\s"]*)$/i.exec(q)
  return m ? { key: m[1]!.toLowerCase() as FilterKey, value: m[2]!, start: m.index + m[0].length - m[2]!.length } : null
}

/** One FTS5 MATCH expression for a word: quoted (so operators are plain text) and prefix-matched. */
export const ftsTerm = (w: string) => `"${w.replace(/"/g, '""')}"*`
