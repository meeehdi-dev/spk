import type { MessageDto } from '../db/messages'

import * as webpush from 'web-push'

import { pushJobs, removePush } from '../db/push'

import { onlineUserIds } from './peers'

let ready: boolean | undefined

/** Fire and forget: Web Push to offline recipients. Does nothing until the VAPID keys are configured. */
export function sendPushes(m: MessageDto) {
  const cfg = useRuntimeConfig()
  if (ready === undefined) {
    ready = !!(cfg.public.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject)
    if (ready) webpush.setVapidDetails(cfg.vapidSubject, cfg.public.vapidPublicKey, cfg.vapidPrivateKey)
  }
  if (!ready) return
  const db = useDb()
  for (const j of pushJobs(db, m, onlineUserIds())) {
    webpush.sendNotification({ endpoint: j.endpoint, keys: j.keys }, JSON.stringify(j.payload), { TTL: 3600 }).catch(e => {
      if (e?.statusCode === 404 || e?.statusCode === 410) removePush(db, j.endpoint) // the browser dropped it
      else console.error(`[error] web push failed: ${e?.statusCode ?? ''} ${e?.message ?? e}`)
    })
  }
}
