import type { ClientRequest, IncomingMessage } from 'node:http'

import type { Db } from '~~/server/db/client'

import { createECDH, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import https, { type RequestOptions } from 'node:https'

import { afterEach, describe, expect, vi } from 'vitest'
import * as webpush from 'web-push'

import { openDm } from '~~/server/db/dms'
import { createMessage } from '~~/server/db/messages'
import { savePush } from '~~/server/db/push'
import { pushSubscriptions } from '~~/server/db/schema'
import { sendPushes } from '~~/server/utils/push'
import { addUser, test } from '~~/tests/fixtures/db'
import { invalidEndpoints, validEndpoints } from '~~/tests/fixtures/push'

const keys = (() => {
  const curve = createECDH('prime256v1')
  return { p256dh: curve.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') }
})()
const vapid = webpush.generateVAPIDKeys()
const endpoint = validEndpoints[0]!
const message = (db: Db) => createMessage(db, 'a', openDm(db, 'a', 'b').id, 'hello')
let status: number | null

test.beforeEach(({ db }) => {
  for (const id of ['a', 'b']) addUser(db, id, { displayName: null })
  vi.stubGlobal('useDb', () => db)
  vi.stubGlobal('useRuntimeConfig', () => ({
    public: { vapidPublicKey: vapid.publicKey },
    vapidPrivateKey: vapid.privateKey,
    vapidSubject: 'mailto:push@example.com',
  }))
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
})

describe('sendPushes', () => {
  test.for(validEndpoints)('delivers to supported subscriptions: %s', async (value, { db }) => {
    savePush(db, 'b', value, keys, {})
    sendPushes(message(db))
    await Promise.resolve()
    const url = new URL(value)
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', timeout: 5000 }),
      expect.any(Function),
    )
  })

  test('removes invalid stored subscriptions before transport and still delivers valid jobs', async ({ db }) => {
    const storedInvalid = invalidEndpoints.filter((value): value is string => typeof value === 'string')
    for (const value of [...storedInvalid, endpoint]) savePush(db, 'b', value, keys, {})
    sendPushes(message(db))
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

  test.for([404, 410])('removes expired subscriptions after HTTP %s', async (code, { db }) => {
    status = code
    savePush(db, 'b', endpoint, keys, {})
    sendPushes(message(db))
    await vi.waitFor(() => expect(db.select().from(pushSubscriptions).all()).toEqual([]))
  })

  test.for([302, 503])('retains subscriptions after HTTP %s and does not follow redirects', async (code, { db }) => {
    status = code
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    savePush(db, 'b', endpoint, keys, {})
    sendPushes(message(db))
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(db.select().from(pushSubscriptions).all()).toHaveLength(1)
    expect(https.request).toHaveBeenCalledTimes(1)
  })

  test('destroys an unresponsive request after five seconds and retains its subscription', async ({ db }) => {
    vi.useFakeTimers()
    status = null
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    savePush(db, 'b', endpoint, keys, {})
    sendPushes(message(db))
    const request = vi.mocked(https.request).mock.results[0]!.value as ClientRequest
    await vi.advanceTimersByTimeAsync(4999)
    expect(request.destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(request.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Socket timeout' }))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Socket timeout'))
    expect(db.select().from(pushSubscriptions).all()).toHaveLength(1)
  })
})
