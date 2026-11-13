import { describe, expect } from 'vitest'

import { openDm } from '~~/server/db/dms'
import { createMessage } from '~~/server/db/messages'
import { pushJobs, savePush, setPushPrefs } from '~~/server/db/push'
import { addChannel, addUser, test } from '~~/tests/fixtures/db'

const keys = { p256dh: 'k', auth: 'a' }

test.beforeEach(({ db }) => {
  for (const id of ['a', 'b', 'c']) addUser(db, id, { displayName: id.toUpperCase() })
  addChannel(db, 't', { name: 'general' })
  for (const id of ['b', 'c']) savePush(db, id, `https://push.example/${id}`, keys, {})
})

describe('push targets', () => {
  test('DM goes to the partner only, never a third user', ({ db }) => {
    const dm = openDm(db, 'a', 'b')
    const jobs = pushJobs(db, createMessage(db, 'a', dm.id, 'hello'), [])
    expect(jobs.map(j => j.endpoint)).toEqual(['https://push.example/b'])
    expect(jobs[0]!.payload).toMatchObject({ title: 'A', body: 'hello' })
  })
  test('channel messages only ping mentioned users; online users are skipped', ({ db }) => {
    expect(pushJobs(db, createMessage(db, 'a', 't', 'plain'), [])).toEqual([])
    const m = createMessage(db, 'a', 't', 'hey <@b> and <@c>')
    expect(pushJobs(db, m, []).map(j => j.payload.title)).toEqual(['A in #general', 'A in #general'])
    expect(pushJobs(db, m, ['c']).map(j => j.endpoint)).toEqual(['https://push.example/b'])
  })
  test('a prefs update touches only that endpoint, and only for its owner', ({ db }) => {
    savePush(db, 'b', 'https://push.example/b2', keys, {})
    setPushPrefs(db, 'b', 'https://push.example/b', { dnd: true })
    setPushPrefs(db, 'c', 'https://push.example/b2', { dnd: true }) // not c's row
    const m = createMessage(db, 'a', 't', 'hey <@b>')
    expect(pushJobs(db, m, []).map(j => j.endpoint)).toEqual(['https://push.example/b2'])
  })
  test('respects the synced settings', ({ db }) => {
    savePush(db, 'b', 'https://push.example/b', keys, { dnd: true })
    const m = createMessage(db, 'a', 't', 'hey <@b> <@c>')
    expect(pushJobs(db, m, []).map(j => j.endpoint)).toEqual(['https://push.example/c'])
  })
})
