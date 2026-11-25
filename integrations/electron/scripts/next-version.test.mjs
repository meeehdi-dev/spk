import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextVersion } from './next-version.mjs'

const c = (...subjects) => subjects.map((subject, i) => ({ sha: `abc${i}`, subject }))

test('first release uses the package.json version', () => {
  assert.deepEqual(nextVersion({ lastTag: null, current: '0.1.0', commits: c('feat(desktop): add client') }), {
    release: true,
    version: '0.1.0',
    notes: '- feat(desktop): add client (abc0)',
  })
})

test('fix bumps patch, feat bumps minor, breaking bumps minor before 1.0 and major after', () => {
  const v = (lastTag, current, ...subjects) => nextVersion({ lastTag, current, commits: c(...subjects) }).version
  assert.equal(v('desktop-v0.1.0', '0.1.0', 'fix(desktop): a', 'chore: b'), '0.1.1')
  assert.equal(v('desktop-v0.1.3', '0.1.3', 'fix(desktop): a', 'feat(desktop): b'), '0.2.0')
  assert.equal(v('desktop-v0.2.1', '0.2.1', 'refactor(desktop)!: a'), '0.3.0')
  assert.equal(v('desktop-v1.2.3', '1.2.3', 'feat!: a'), '2.0.0')
})

test('nothing to release when only release commits changed the app', () => {
  assert.equal(nextVersion({ lastTag: 'desktop-v0.2.0', current: '0.2.0', commits: c('chore(desktop): release 0.2.0 [skip ci]') }).release, false)
  assert.equal(nextVersion({ lastTag: 'desktop-v0.2.0', current: '0.2.0', commits: [] }).release, false)
})

test('a committed bump whose release failed is released as is', () => {
  const result = nextVersion({ lastTag: 'desktop-v0.2.0', current: '0.3.0', commits: c('chore(desktop): release 0.3.0 [skip ci]') })
  assert.deepEqual(result, { release: true, version: '0.3.0', notes: '' })
})
