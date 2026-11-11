import { beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../server/db/client'
import { openDm } from '../server/db/dms'
import { createMessage } from '../server/db/messages'
import { pushJobs, savePush } from '../server/db/push'
import { channels, user } from '../server/db/schema'
import { allowedBy, notificationBody } from '../shared/utils/notifyText'

const names: Record<string, string> = { u1: 'Alex' }
const nameOf = (id: string) => names[id] ?? 'someone'

describe('notificationBody', () => {
  it('strips Markdown, shows mentions as names, hides spoilers and code', () => {
    expect(notificationBody('**hi** <@u1>, see [docs](https://x.dev) and `code` ~~no~~ _yes_', nameOf)).toBe('hi @Alex, see docs and code no yes')
    expect(notificationBody('the answer is ||42|| ok', nameOf)).toBe('the answer is [spoiler] ok')
    expect(notificationBody('||hey <@u1>||', nameOf)).toBe('[spoiler]')
    expect(notificationBody('look\n```ts\nconst secret = 1\n```\nbye', nameOf)).toBe('look [code] bye')
    expect(notificationBody('> quoted\n- item\nsnake_case_name', nameOf)).toBe('quoted item snake_case_name')
  })
  it('truncates', () => expect(notificationBody('x'.repeat(500), nameOf)).toHaveLength(140))
})

describe('push targets', () => {
  let db: Db
  beforeEach(() => {
    db = createDb(':memory:')
    for (const id of ['a', 'b', 'c'])
      db.insert(user)
        .values({ id, name: id, email: `${id}@x.dev`, displayName: id.toUpperCase() })
        .run()
    db.insert(channels).values({ id: 't', type: 'text', name: 'general' }).run()
    for (const id of ['b', 'c']) savePush(db, id, `https://push.example/${id}`, { p256dh: 'k', auth: 'a' }, {})
  })
  it('DM goes to the partner only, never a third user', () => {
    const dm = openDm(db, 'a', 'b')
    const jobs = pushJobs(db, createMessage(db, 'a', dm.id, 'hello'), [])
    expect(jobs.map(j => j.endpoint)).toEqual(['https://push.example/b'])
    expect(jobs[0]!.payload).toMatchObject({ title: 'A', body: 'hello' })
  })
  it('channel messages only ping mentioned users; online users are skipped', () => {
    expect(pushJobs(db, createMessage(db, 'a', 't', 'plain'), [])).toEqual([])
    const m = createMessage(db, 'a', 't', 'hey <@b> and <@c>')
    expect(pushJobs(db, m, []).map(j => j.payload.title)).toEqual(['A in #general', 'A in #general'])
    expect(pushJobs(db, m, ['c']).map(j => j.endpoint)).toEqual(['https://push.example/b'])
  })
  it('respects the synced settings', () => {
    savePush(db, 'b', 'https://push.example/b', { p256dh: 'k', auth: 'a' }, { dnd: true })
    const m = createMessage(db, 'a', 't', 'hey <@b> <@c>')
    expect(pushJobs(db, m, []).map(j => j.endpoint)).toEqual(['https://push.example/c'])
    expect(allowedBy({ muted: ['t'] }, 't', false)).toBe(false)
    expect(allowedBy({ dms: false }, 'd', true)).toBe(false)
    expect(allowedBy({ pings: false }, 'd', true)).toBe(true)
  })
})
