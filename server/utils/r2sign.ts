import { AwsClient } from 'aws4fetch'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export const r2Url = (c: R2Config, key: string) => {
  // `..` would be normalised away by URL and sign a different object than the key names.
  if (key.split('/').some(s => s === '.' || s === '..')) throw new Error('Invalid R2 key')
  return `https://${c.accountId}.r2.cloudflarestorage.com/${c.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function r2Client(c: R2Config) {
  return new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: 's3', region: 'auto' })
}

/** Presigned PUT with Content-Length and Content-Type signed, so the client can't send another size or type. */
export async function presignPut(c: R2Config, key: string, o: { size: number; type: string; expiresIn?: number }) {
  const url = new URL(r2Url(c, key))
  url.searchParams.set('X-Amz-Expires', String(o.expiresIn ?? 600))
  const req = await r2Client(c).sign(url.toString(), {
    method: 'PUT',
    headers: { 'content-type': o.type, 'content-length': String(o.size) },
    aws: { signQuery: true, allHeaders: true },
  })
  return req.url
}

export async function presignGet(c: R2Config, key: string, expiresIn = 600, disposition?: string) {
  const url = new URL(r2Url(c, key))
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  if (disposition) url.searchParams.set('response-content-disposition', disposition)
  return (await r2Client(c).sign(url.toString(), { method: 'GET', aws: { signQuery: true } })).url
}

export async function r2Put(c: R2Config, key: string, body: Uint8Array, type: string) {
  const res = await r2Client(c).fetch(r2Url(c, key), { method: 'PUT', body: body as BodyInit, headers: { 'content-type': type } })
  if (!res.ok) throw new Error(`R2 PUT ${res.status}`)
}

export async function r2Get(c: R2Config, key: string, maxBytes: number) {
  const res = await r2Client(c).fetch(r2Url(c, key))
  if (!res.ok) throw new Error(`R2 GET ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error('Object too large')
  return buf
}

export async function r2Delete(c: R2Config, key: string) {
  const res = await r2Client(c).fetch(r2Url(c, key), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`)
}

/** Size of an object in bytes, or null if it doesn't exist. */
export async function r2Size(c: R2Config, key: string) {
  const res = await r2Client(c).fetch(r2Url(c, key), { method: 'HEAD' })
  return res.ok ? Number(res.headers.get('content-length')) : null
}
