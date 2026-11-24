import type { Embed } from '../../shared/utils/embed'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isScalar = (v: unknown): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v)

const PALETTE: Record<NonNullable<Embed['color']>, number> = {
  success: 0x22c55e,
  error: 0xef4444,
  warning: 0xf59e0b,
  info: 0x3b82f6,
  neutral: 0x6b7280,
}
const COLORS = Object.keys(PALETTE) as NonNullable<Embed['color']>[]
const SLACK_COLORS: Record<string, Embed['color']> = { good: 'success', danger: 'error', warning: 'warning' }

/** Nearest status colour to an RGB integer (Discord) or `#rrggbb` string (Slack). */
function nearestColor(v: unknown): Embed['color'] {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^#?[\da-f]{6}$/i.test(v) ? parseInt(v.replace('#', ''), 16) : NaN
  if (!Number.isInteger(n) || n < 0 || n > 0xffffff) return undefined
  const d = (c: number) => [16, 8, 0].reduce((s, sh) => s + (((n >> sh) & 255) - ((c >> sh) & 255)) ** 2, 0)
  return COLORS.reduce((best, k) => (d(PALETTE[k]) < d(PALETTE[best]) ? k : best))
}

/** Keyword guess from an event/status string. "unhealthy" must be tested before "healthy". */
function keywordColor(text: string): Embed['color'] {
  if (/fail|error|unhealthy|\bdown\b|crash/i.test(text)) return 'error'
  if (/warn/i.test(text)) return 'warning'
  if (/success|succeeded|healthy|\bup\b/i.test(text)) return 'success'
  return undefined
}

// `<@...>` is the only mention syntax (shared/utils/markdown.ts); there is no role or @everyone token.
// One linear pass: drop real tokens, then break any `<@` left over (e.g. from `<<@x>@abc>`) with a zero-width space.
const stripMentions = (s: string) => s.replace(/<@[\w-]+>/g, '').replaceAll('<@', '<\u200b@')
const text = (v: unknown, max: number) => {
  if (!isScalar(v)) return undefined
  const s = stripMentions(String(v)).trim().slice(0, max)
  return s || undefined
}
const httpUrl = (v: unknown) => {
  if (typeof v !== 'string') return undefined
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}
const isoDate = (v: unknown) => {
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined
}

/** Enforces caps, http(s)-only urls, no mention tokens and the colour whitelist. Returns undefined when nothing is left. */
export function sanitizeEmbed(input: unknown): Embed | undefined {
  if (!isObj(input)) return undefined
  const fields = (Array.isArray(input.fields) ? input.fields : [])
    .slice(0, 25)
    .map(f => (isObj(f) ? { name: text(f.name, 256), value: text(f.value, 1024), inline: f.inline === true } : null))
    .filter((f): f is { name: string; value: string; inline: boolean } => !!f?.name && !!f.value)
  const e: Embed = {
    title: text(input.title, 256),
    description: text(input.description, 4096),
    url: httpUrl(input.url),
    color: COLORS.find(c => c === input.color),
    fields: fields.length ? fields : undefined,
    footer: text(input.footer, 256),
    timestamp: isoDate(input.timestamp),
  }
  const out = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)) as Embed
  return out.title || out.description || out.fields ? out : undefined
}

const discord = (p: Obj, e: Obj) => ({
  body: text(p.content, 4096) ?? '',
  embed: {
    title: e.title,
    description: e.description,
    url: e.url,
    color: nearestColor(e.color),
    fields: e.fields,
    footer: isObj(e.footer) ? e.footer.text : undefined,
    timestamp: e.timestamp,
  },
})

const slack = (p: Obj, a: Obj) => ({
  body: text(p.text, 4096) ?? '',
  embed: {
    title: a.title,
    url: a.title_link,
    description: a.text ?? a.fallback,
    color: SLACK_COLORS[String(a.color)] ?? nearestColor(a.color),
    fields: Array.isArray(a.fields) ? a.fields.map(f => (isObj(f) ? { name: f.title, value: f.value, inline: f.short === true } : null)) : undefined,
    footer: a.footer,
    timestamp: typeof a.ts === 'number' ? a.ts * 1000 : undefined,
  },
})

const URL_KEYS = ['url', 'link', 'html_url']
const TITLE_KEYS = ['title', 'event', 'subject']
const DESC_KEYS = ['message', 'text', 'content', 'body']

/** Coolify and anything else: title/message keys, scalars as inline fields, nested data as a json block. */
function generic(p: Obj) {
  const used = new Set<string>()
  const pick = (keys: string[]) => {
    const k = keys.find(k => isScalar(p[k]) && String(p[k]).trim())
    if (k) used.add(k)
    return k ? String(p[k]).trim() : undefined
  }
  let title = pick(TITLE_KEYS)
  let description = pick(DESC_KEYS)
  const uk = URL_KEYS.find(k => httpUrl(p[k]))
  if (uk) used.add(uk)
  if (!title && description) [title, description] = [description.split('\n')[0], description.split('\n').slice(1).join('\n')]
  const rest = Object.entries(p).filter(([k]) => !used.has(k))
  const scalars = rest.filter(([, v]) => isScalar(v)).slice(0, 10)
  const nested = Object.fromEntries(rest.filter(([, v]) => !isScalar(v)))
  if (Object.keys(nested).length) description = `${description ?? ''}\n\`\`\`json\n${JSON.stringify(nested, null, 2).slice(0, 4000)}\n\`\`\``
  const status = [p.status, p.level, p.severity].find(isScalar)
  return {
    body: '',
    embed: {
      title,
      description,
      url: uk && p[uk],
      color: keywordColor(`${p.event ?? ''} ${status ?? ''} ${title ?? ''}`),
      fields: scalars.map(([name, value]) => ({ name, value, inline: true })),
    },
  }
}

/** Turns a raw webhook request body into message text plus an optional embed. Null when there is nothing to post. */
export function formatPayload(contentType: string, raw: string): { body: string; embed?: Embed } | null {
  const plain = (s: string) => {
    const body = stripMentions(s).trim()
    return body ? { body } : null
  }
  if (!/json/i.test(contentType)) return plain(raw)
  let p: unknown
  try {
    p = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(p)) return Array.isArray(p) || p === null ? formatNested(p) : plain(String(p))
  const dEmbed = Array.isArray(p.embeds) && isObj(p.embeds[0]) ? p.embeds[0] : null
  const sAttach = Array.isArray(p.attachments) && isObj(p.attachments[0]) ? p.attachments[0] : null
  let r: { body: string; embed?: Obj }
  if (dEmbed) r = discord(p, dEmbed)
  else if (sAttach) r = slack(p, sAttach)
  else if (Object.keys(p).every(k => ['text', 'content', 'username', 'icon_emoji', 'channel'].includes(k)) && (p.text ?? p.content) !== undefined)
    r = { body: text(p.text ?? p.content, 4096) ?? '' }
  else r = generic(p)
  const embed = sanitizeEmbed(r.embed)
  return r.body || embed ? { body: r.body, embed } : null
}

const formatNested = (p: unknown) =>
  p == null ? null : { body: '', embed: sanitizeEmbed({ description: `\`\`\`json\n${JSON.stringify(p, null, 2).slice(0, 4000)}\n\`\`\`` }) }
