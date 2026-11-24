import { eq, inArray } from 'drizzle-orm'

import { BOT_ID } from '../../shared/utils/bot'
import { extractMentionIds, MAX_BODY_BYTES } from '../../shared/utils/markdown'
import { ChatError, createMessage, listMessages, type MessageDto } from '../db/messages'
import { channels, user } from '../db/schema'

import { fanOut, publishMessage } from './chat'
import { createLimiter } from './limiter'

const allowReply = createLimiter(3, 60_000) // 3 replies per minute per author
const SYSTEM = 'You are spk, a bot in a small group chat. Answer briefly and plainly. Markdown is fine.'
const FALLBACK = "Sorry, I couldn't answer that right now."

async function ask(apiKey: string, prompt: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 500, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  const text = (data.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('')
    .replace(/<@[\w-]+>/g, '')
    .trim()
  return Buffer.from(text).subarray(0, MAX_BODY_BYTES).toString()
}

/** Answers when the bot is @mentioned or replied to in a text channel. Never throws. */
export async function maybeReply(message: MessageDto) {
  const apiKey = useRuntimeConfig().anthropicApiKey as string | undefined
  if (!apiKey || message.userId === BOT_ID) return
  if (!extractMentionIds(message.body).includes(BOT_ID) && message.replyTo?.userId !== BOT_ID) return
  const db = useDb()
  const ch = db.select().from(channels).where(eq(channels.id, message.channelId)).get()
  if (ch?.type !== 'text' || !db.select().from(user).where(eq(user.id, BOT_ID)).get() || !allowReply(message.userId)) return

  const typing = () => fanOut(message.channelId, BOT_ID, { type: 'typing', channelId: message.channelId, userId: BOT_ID }, false)
  typing()
  const timer = setInterval(typing, 4_000)
  try {
    let text: string
    try {
      const history = listMessages(db, message.channelId, { limit: 20 }).messages
      const ids = new Set([...history.map(m => m.userId), ...history.flatMap(m => extractMentionIds(m.body))])
      const names = new Map(
        db
          .select({ id: user.id, name: user.displayName, login: user.name })
          .from(user)
          .where(inArray(user.id, [...ids]))
          .all()
          .map(u => [u.id, u.name ?? u.login]),
      )
      const name = (id: string) => names.get(id) ?? 'unknown'
      const prompt = history.map(m => `${name(m.userId)}: ${m.body.replace(/<@([\w-]+)>/g, (_, id: string) => `@${name(id)}`)}`).join('\n')
      text = await ask(apiKey, prompt)
    } catch (e) {
      console.error('[bot] reply failed', e)
      text = FALLBACK
    }
    if (!text) return
    publishMessage(createMessage(db, BOT_ID, message.channelId, text, Date.now(), { replyToId: message.id }))
  } catch (e) {
    // Called with `void`: rethrowing would be an unhandled rejection.
    console.error('[bot] could not post reply', e instanceof ChatError ? e.message : e)
  } finally {
    clearInterval(timer)
  }
}
