import { sql, type SQL } from 'drizzle-orm'
import type { Db } from './client'
import { accessibleChannel, ChatError } from './messages'
import { ftsTerm, hasAnything, parseSearch } from '../../shared/utils/searchQuery'

export type SearchScope = 'channel' | 'channels' | 'dms' | 'everything'
export const PAGE = 20
/** Copy-text limit per result; the snippet is what the panel shows. */
const TEXT_MAX = 4000
export const MARK_START = '\u0001'
export const MARK_END = '\u0002'

export interface SearchHit { messageId: string, channelId: string, userId: string, createdAt: number, snippet: string, text: string, attachments: number }
export interface SearchResult { results: SearchHit[], nextCursor: string | null }

const lowerIn = (col: string, vals: string[]) => sql`lower(${sql.raw(col)}) IN (${sql.join(vals.map(v => sql`${v.toLowerCase()}`), sql`, `)})`

/** Ids of users whose current nickname matches (case-insensitive). */
const userIds = (db: Db, names: string[]) =>
  names.length ? db.all<{ id: string }>(sql`SELECT id FROM users WHERE ${lowerIn('display_name', names)}`).map(r => r.id) : []

const idList = (ids: string[]) => ids.length ? sql.join(ids.map(i => sql`${i}`), sql`, `) : sql`NULL`

/**
 * Searches only what `userId` can read: text channels and their own DMs. Deleted messages are excluded
 * (they are also gone from the FTS table). Names are resolved against current nicknames at search time.
 */
export function searchMessages(db: Db, userId: string, opts: { q?: unknown, scope?: unknown, channelId?: unknown, cursor?: unknown }): SearchResult {
  const p = parseSearch(typeof opts.q === 'string' ? opts.q.slice(0, 300) : '')
  if (!hasAnything(p)) return { results: [], nextCursor: null }
  const scope: SearchScope = (['channel', 'channels', 'dms', 'everything'] as const).find(s => s === opts.scope) ?? 'everything'
  const offset = typeof opts.cursor === 'string' && /^\d{1,6}$/.test(opts.cursor) ? Number(opts.cursor) : 0

  const dmOk = sql`c.id IN (SELECT channel_id FROM channel_members WHERE user_id = ${userId})`
  const where: SQL[] = [sql`m.deleted_at IS NULL`]
  if (scope === 'channel') {
    if (typeof opts.channelId !== 'string' || !accessibleChannel(db, userId, opts.channelId)) throw new ChatError(403, 'No access to this channel')
    where.push(sql`c.id = ${opts.channelId}`)
  } else {
    where.push(sql`(c.type = 'text' OR (c.type = 'dm' AND ${dmOk}))`)
    if (scope === 'channels') where.push(sql`c.type = 'text'`)
    if (scope === 'dms') where.push(sql`c.type = 'dm'`)
  }
  if (p.from.length) where.push(sql`m.user_id IN (${idList(userIds(db, p.from))})`)
  if (p.mentions.length) where.push(sql`m.id IN (SELECT message_id FROM message_mentions WHERE user_id IN (${idList(userIds(db, p.mentions))}))`)
  if (p.in.length) where.push(sql`c.type = 'text' AND ${lowerIn('c.name', p.in)}`)
  for (const h of p.has) {
    if (h === 'file') where.push(sql`EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)`)
    if (h === 'image') where.push(sql`EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.mime LIKE 'image/%')`)
    if (h === 'link') where.push(sql`(instr(lower(m.body), 'http://') > 0 OR instr(lower(m.body), 'https://') > 0)`)
  }
  if (p.before !== undefined) where.push(sql`m.created_at < ${p.before}`)
  if (p.after !== undefined) where.push(sql`m.created_at >= ${p.after}`)

  // Every word must match: in the text (prefix), or, when it is a nickname, as a mention of that user.
  for (const w of p.terms) {
    const mentioned = userIds(db, [w.replace(/^@/, '')])
    where.push(mentioned.length
      ? sql`(m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${ftsTerm(w)}) OR m.id IN (SELECT message_id FROM message_mentions WHERE user_id IN (${idList(mentioned)})))`
      : sql`m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${ftsTerm(w)})`)
  }

  // Rank and highlight with one OR query over all words; messages that matched only by mention rank last.
  const ranked = p.terms.length
  const rows = db.all<{ id: string, channel_id: string, user_id: string, created_at: number, body: string, snip: string | null, files: number }>(sql`
    SELECT m.id, m.channel_id, m.user_id, m.created_at, substr(m.body, 1, ${TEXT_MAX}) AS body,
      ${ranked ? sql`h.snip` : sql`NULL`} AS snip,
      (SELECT count(*) FROM attachments a WHERE a.message_id = m.id) AS files
    FROM messages m
    JOIN channels c ON c.id = m.channel_id
    ${ranked ? sql`LEFT JOIN (
      SELECT rowid AS r, bm25(messages_fts) AS rank, snippet(messages_fts, 0, ${MARK_START}, ${MARK_END}, '…', 16) AS snip
      FROM messages_fts WHERE messages_fts MATCH ${p.terms.map(ftsTerm).join(' OR ')}
    ) h ON h.r = m.rowid` : sql``}
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY ${ranked ? sql`h.rank IS NULL, h.rank, ` : sql``}m.created_at DESC, m.id DESC
    LIMIT ${PAGE + 1} OFFSET ${offset}`)

  return {
    results: rows.slice(0, PAGE).map(r => ({
      messageId: r.id, channelId: r.channel_id, userId: r.user_id, createdAt: r.created_at,
      snippet: r.snip ?? r.body.replace(/\s+/g, ' ').trim().slice(0, 160), text: r.body, attachments: r.files
    })),
    nextCursor: rows.length > PAGE ? String(offset + PAGE) : null
  }
}
