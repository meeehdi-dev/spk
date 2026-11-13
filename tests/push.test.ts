import type { ClientRequest, IncomingMessage } from 'node:http'

import { createECDH, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import https, { type RequestOptions } from 'node:https'

import { createError, defineEventHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as webpush from 'web-push'

import { createDb, type Db } from '../server/db/client'
import { openDm } from '../server/db/dms'
import { createMessage } from '../server/db/messages'
import { savePush } from '../server/db/push'
import { pushSubscriptions, user } from '../server/db/schema'
import { sendPushes } from '../server/utils/push'
import { isPushEndpoint } from '../server/utils/pushEndpoint'

const validEndpoints = [
  'https://fcm.googleapis.com/fcm/send/token',
  'https://updates.push.services.mozilla.com/wpush/v2/token',
  'https://web.push.apple.com/token',
  'https://region.web.push.apple.com/token',
  'https://wns2-db5p.notify.windows.com/w/?token=a%2Fb',
  'https://region.wns2-db5p.notify.windows.com/w/?token=opaque',
  'https://WNS2-DB5P.NOTIFY.WINDOWS.COM:443/w/?token=opaque',
  'https://FCM.GOOGLEAPIS.COM:443/opaque/path?token=a%2Fb',
]
const invalidEndpoints = [
  undefined,
  null,
  123,
  '',
  'not a URL',
  'http://fcm.googleapis.com/token',
  'https:fcm.googleapis.com/token',
  'https:///fcm.googleapis.com/token',
  'https://127.0.0.1:8443/internal',
  'https://10.0.0.1/internal',
  'https://169.254.169.254/latest/meta-data',
  'https://2130706433/internal',
  'https://[::1]/internal',
  'https://[::ffff:127.0.0.1]/internal',
  'https://8.8.8.8/token',
  'https://localhost/token',
  'https://push.example/token',
  'https://user:password@fcm.googleapis.com/token',
  'https://fcm.googleapis.com:8443/token',
  'https://fcm.googleapis.com.evil.example/token',
  'https://evilfcm.googleapis.com/token',
  'https://evilpush.apple.com/token',
  'https://web.push.apple.com.evil.example/token',
  'https://push.apple.com/token',
  'https://.push.apple.com/token',
  'https://web..push.apple.com/token',
  'https://notify.windows.com/w/',
  'https://.notify.windows.com/w/',
  'https://wns2..notify.windows.com/w/',
  'https://evilnotify.windows.com/w/',
  'https://wns2-db5p.notify.windows.com.evil.example/w/',
  'https://wns2-db5p.notify.windows.com./w/',
  'http://wns2-db5p.notify.windows.com/w/',
  'https://user:password@wns2-db5p.notify.windows.com/w/',
  'https://wns2-db5p.notify.windows.com:8443/w/',
  'https://wns2-db5p.notify.windows.com/w/#fragment',
  'https://fcm.googleapis.com./token',
  'https://web.push.apple.com./token',
  'https://updates.push.services.mozilla.com.evil.example/token',
  'https://fcm.googleapis.com@127.0.0.1/internal',
  'https://fcm.googleapis.com/token#fragment',
  'https://fcm.googleapis.com/token#',
  ' https://fcm.googleapis.com/token',
  'https://fcm.googleapis.com/token\n',
  'https://fcm.google\tapis.com/token',
  'https://fcm.googleapis.com\\token',
]

describe('push endpoint policy', () => {
  it.each(validEndpoints)('accepts %s', endpoint => expect(isPushEndpoint(endpoint)).toBe(true))
  it.each(invalidEndpoints)('rejects %s', endpoint => expect(isPushEndpoint(endpoint)).toBe(false))
})

describe('push registration and delivery', () => {
  let db: Db
  let status: number | null
  const keys = (() => {
    const curve = createECDH('prime256v1')
    return { p256dh: curve.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') }
  })()
  const vapid = webpush.generateVAPIDKeys()
  const endpoint = validEndpoints[0]!

  beforeEach(() => {
    db = createDb(':memory:')
    for (const id of ['a', 'b'])
      db.insert(user)
        .values({ id, name: id, email: `${id}@example.com` })
        .run()
    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { vapidPublicKey: vapid.publicKey },
      vapidPrivateKey: vapid.privateKey,
      vapidSubject: 'mailto:push@example.com',
    }))
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('requireUser', async () => ({ id: 'b' }))
    status = 201
    vi.spyOn(https, 'request').mockImplementation((...args: unknown[]) => {
      const options = args[0] as RequestOptions
      const respond = args[1] as (response: IncomingMessage) => void
      const request = Object.assign(new EventEmitter(), {
        write: () => true,
        destroy(error: Error) {
          request.emit('error', error)
          return request
        },
        end() {
          if (status === null) setTimeout(() => request.emit('timeout'), options.timeout)
          else
            queueMicrotask(() => {
              const response = Object.assign(new EventEmitter(), { statusCode: status, headers: {} })
              respond(response as IncomingMessage)
              response.emit('end')
            })
          return request
        },
      })
      vi.spyOn(request, 'destroy')
      return request as unknown as ClientRequest
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    db.$client.close()
  })

  async function register(value: unknown, subscriptionKeys: unknown = keys) {
    vi.stubGlobal('readBody', async () => ({ subscription: { endpoint: value, keys: subscriptionKeys } }))
    const { default: handler } = await import('../server/api/push/index.post')
    return handler({} as never)
  }

  const message = () => createMessage(db, 'a', openDm(db, 'a', 'b').id, 'hello')

  it.each(invalidEndpoints)('rejects registration without saving or sending: %s', async value => {
    await expect(register(value)).rejects.toMatchObject({ statusCode: 400, message: 'Invalid subscription' })
    expect(db.select().from(pushSubscriptions).all()).toEqual([])
    expect(https.request).not.toHaveBeenCalled()
  })

  it.each(validEndpoints)('registers and delivers supported subscriptions: %s', async value => {
    await expect(register(value)).resolves.toEqual({ ok: true })
    expect(db.select().from(pushSubscriptions).get()).toMatchObject({ endpoint: value, userId: 'b' })
    sendPushes(message())
    await Promise.resolve()
    const url = new URL(value)
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', timeout: 5000 }),
      expect.any(Function),
    )
  })

  it.each([null, {}, { p256dh: 123, auth: 'a' }, { p256dh: 'k', auth: 123 }])('keeps key validation: %s', async value => {
    await expect(register(endpoint, value)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.select().from(pushSubscriptions).all()).toEqual([])
  })

  it('removes invalid stored subscriptions before transport and still delivers valid jobs', async () => {
    const storedInvalid = invalidEndpoints.filter((value): value is string => typeof value === 'string')
    for (const value of [...storedInvalid, endpoint]) savePush(db, 'b', value, keys, {})
    sendPushes(message())
    await Promise.resolve()
    expect(
      db
        .select()
        .from(pushSubscriptions)
        .all()
        .map(row => row.endpoint),
    ).toEqual([endpoint])
    expect(https.request).toHaveBeenCalledTimes(1)
    expect(https.request).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'fcm.googleapis.com' }), expect.any(Function))
  })

  it.each([404, 410])('removes expired subscriptions after HTTP %s', async code => {
    status = code
    savePush(db, 'b', endpoint, keys, {})
    sendPushes(message())
    await vi.waitFor(() => expect(db.select().from(pushSubscriptions).all()).toEqual([]))
  })

  it.each([302, 503])('retains subscriptions after HTTP %s and does not follow redirects', async code => {
    status = code
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    savePush(db, 'b', endpoint, keys, {})
    sendPushes(message())
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(db.select().from(pushSubscriptions).all()).toHaveLength(1)
    expect(https.request).toHaveBeenCalledTimes(1)
  })

  it('destroys an unresponsive request after five seconds and retains its subscription', async () => {
    vi.useFakeTimers()
    status = null
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    savePush(db, 'b', endpoint, keys, {})
    sendPushes(message())
    const request = vi.mocked(https.request).mock.results[0]!.value as ClientRequest
    await vi.advanceTimersByTimeAsync(4999)
    expect(request.destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(request.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Socket timeout' }))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Socket timeout'))
    expect(db.select().from(pushSubscriptions).all()).toHaveLength(1)
  })
})
