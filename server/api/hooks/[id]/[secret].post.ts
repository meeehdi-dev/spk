import { createMessage } from '../../../db/messages'
import { verifyWebhook } from '../../../db/webhooks'
import { asHttp } from '../../../utils/http'
import { createLimiter } from '../../../utils/limiter'
import { formatPayload } from '../../../utils/webhookPayload'

const MAX_BYTES = 1024 * 1024
const allowPost = createLimiter(30, 60_000) // per webhook
const allowFailure = createLimiter(20, 60_000) // failed attempts per IP

// The secret in the path is the auth, so this route is exempt from sameOrigin.
export default defineEventHandler(async event => {
  const ip = getRequestIP(event) ?? 'unknown'
  const fail = (statusCode: number, message: string) => createError({ statusCode, message })
  const bad = () => (allowFailure(ip) ? fail(404, 'Not found') : fail(429, 'Too many attempts'))

  const id = getRouterParam(event, 'id') ?? ''
  const w = verifyWebhook(useDb(), id, getRouterParam(event, 'secret') ?? '')
  if (!w) throw bad()
  if (Number(getRequestHeader(event, 'content-length')) > MAX_BYTES) throw fail(413, 'Payload over 1 MB')
  if (!allowPost(w.channelId)) throw fail(429, 'Too many alerts')
  // Read the stream with a cap: content-length may be absent (chunked) or a lie.
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    size += chunk.length
    if (size > MAX_BYTES) throw fail(413, 'Payload over 1 MB')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const p = formatPayload(getRequestHeader(event, 'content-type') ?? '', raw, getRequestHeader(event, 'x-github-event'))
  if (!p) throw fail(400, 'Empty or unreadable payload')
  if (p === 'skip') {
    setResponseStatus(event, 204)
    return null
  }

  const message = await asHttp(() => createMessage(useDb(), w.ownerId, w.channelId, p.body, Date.now(), { asWebhook: true, embed: p.embed }))
  publishMessage(message, { previews: false })
  setResponseStatus(event, 204)
  return null
})
