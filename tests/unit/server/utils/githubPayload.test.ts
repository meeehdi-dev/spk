import { describe, expect, test } from 'vitest'

import { formatPayload } from '~~/server/utils/webhookPayload'

const repository = { name: 'spk', full_name: 'me/spk', html_url: 'https://g.dev/me/spk' }
const sender = { login: 'bob', html_url: 'https://github.com/bob', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' }
const run = (event: string, p: object, ct = 'application/json') => formatPayload(ct, JSON.stringify({ repository, sender, ...p }), event)

describe('GitHub events via formatPayload', () => {
  test.each([
    [
      'ping',
      { hook: { events: ['push', 'issues'] } },
      {
        title: '[spk] Webhook connected',
        description: 'push, issues',
        color: 'info',
        footer: 'me/spk',
        author: { name: 'bob', url: 'https://github.com/bob', icon: 'https://avatars.githubusercontent.com/u/1?v=4&s=40' },
      },
    ],
    [
      'push',
      {
        ref: 'refs/heads/main',
        compare: 'https://g.dev/c',
        commits: Array.from({ length: 7 }, (_, i) => ({ id: `abcdef${i}0000`, message: `m${i}\nbody`, author: { name: 'Al' } })),
      },
      { title: '[spk:main] 7 new commits', url: 'https://g.dev/c', color: 'neutral', description: expect.stringContaining('`abcdef0` m0 — Al') },
    ],
    [
      'push',
      { ref: 'refs/tags/v1', forced: true, commits: [{ id: 'abc1234', message: 'x', author: { name: 'A' } }] },
      { title: '[spk:v1] 1 force-pushed commit', color: 'warning' },
    ],
    [
      'pull_request',
      { action: 'opened', pull_request: { number: 12, title: 'Add', body: 'b'.repeat(400), html_url: 'https://g.dev/p' } },
      { title: '[spk] PR #12 opened: Add', color: 'info', url: 'https://g.dev/p' },
    ],
    ['pull_request', { action: 'closed', pull_request: { number: 12, title: 'Add', merged: true } }, { title: '[spk] PR #12 merged: Add', color: 'success' }],
    ['pull_request', { action: 'closed', pull_request: { number: 12, title: 'Add', merged: false } }, { title: '[spk] PR #12 closed: Add', color: 'error' }],
    ['pull_request', { action: 'ready_for_review', pull_request: { number: 1, title: 'T' } }, { title: '[spk] PR #1 ready for review: T', color: 'info' }],
    ['issues', { action: 'reopened', issue: { number: 5, title: 'Bug' } }, { title: '[spk] Issue #5 reopened: Bug', color: 'info' }],
    [
      'issue_comment',
      { action: 'created', issue: { number: 5, title: 'Bug' }, comment: { body: 'hi' } },
      { title: '[spk] New comment on #5: Bug', description: 'hi', color: 'neutral' },
    ],
    [
      'pull_request_review',
      { action: 'submitted', pull_request: { number: 12 }, review: { state: 'changes_requested', body: 'no' } },
      { title: '[spk] PR #12 changes requested', color: 'warning' },
    ],
    [
      'pull_request_review',
      { action: 'submitted', pull_request: { number: 12 }, review: { state: 'approved' } },
      { title: '[spk] PR #12 approved', color: 'success' },
    ],
    [
      'release',
      { action: 'published', release: { tag_name: 'v1.2', body: 'notes' } },
      { title: '[spk] Release v1.2 published', description: 'notes', color: 'success' },
    ],
    [
      'workflow_run',
      { action: 'completed', workflow_run: { name: 'CI', head_branch: 'main', conclusion: 'success' } },
      { title: '[spk] CI ✓ CI on main', color: 'success' },
    ],
    [
      'workflow_run',
      { action: 'completed', workflow_run: { name: 'CI', head_branch: 'main', conclusion: 'cancelled' } },
      { title: '[spk] CI ⊘ CI on main (cancelled)', color: 'warning' },
    ],
    [
      'workflow_run',
      { action: 'completed', workflow_run: { name: 'CI', head_branch: 'main', conclusion: 'timed_out' } },
      { title: '[spk] CI ✗ CI on main (timed out)', color: 'error' },
    ],
    [
      'workflow_run',
      { action: 'completed', workflow_run: { name: 'CI', head_branch: 'main', conclusion: 'skipped' } },
      { title: '[spk] CI – CI on main (skipped)', color: 'neutral' },
    ],
    ['create', { ref_type: 'branch', ref: 'x' }, { title: '[spk] Branch x created', color: 'neutral' }],
    ['delete', { ref_type: 'tag', ref: 'v0' }, { title: '[spk] Tag v0 deleted' }],
    ['star', { action: 'created' }, { title: '[spk] ⭐ Starred by bob' }],
    ['fork', { forkee: { full_name: 'al/spk', html_url: 'https://g.dev/al/spk' } }, { title: '[spk] Forked to al/spk', url: 'https://g.dev/al/spk' }],
    ['deployment', { action: 'created' }, { title: '`deployment.created` on spk (not formatted yet)', color: 'neutral' }],
  ])('%s', (event, p, embed) => {
    expect(run(event, p)).toMatchObject({ body: '', embed })
  })
  test('unknown event without action or repo', () => {
    expect(formatPayload('application/json', '{}', 'gollum')).toMatchObject({ embed: { title: '`gollum` (not formatted yet)' } })
  })
  test('PR body is capped at 300 chars', () => {
    const r = run('pull_request', { action: 'opened', pull_request: { number: 1, title: 'T', body: 'b'.repeat(400) } })
    expect(r).toMatchObject({ embed: { description: 'b'.repeat(300) } })
  })
  test('mentions are stripped from a PR body', () => {
    const r = run('pull_request', { action: 'opened', pull_request: { number: 1, title: 'T', body: 'hi <@abc> there' } })
    expect(JSON.stringify(r)).not.toContain('<@abc>')
  })
  test.each([
    ['push', { ref: 'refs/heads/x', commits: [] }],
    ['pull_request', { action: 'synchronize', pull_request: { number: 1 } }],
    ['pull_request', { action: 'labeled', pull_request: { number: 1 } }],
    ['issues', { action: 'edited', issue: { number: 1 } }],
    ['issue_comment', { action: 'deleted' }],
    ['pull_request_review', { action: 'edited' }],
    ['release', { action: 'created' }],
    ['workflow_run', { action: 'requested' }],
    ['star', { action: 'deleted' }],
    ['workflow_job', {}],
    ['check_run', {}],
    ['check_suite', {}],
    ['status', {}],
  ])('%s %j is skipped', (event, p) => {
    expect(run(event, p)).toBe('skip')
  })
  test('missing fields do not crash', () => {
    expect(() => formatPayload('application/json', '{}', 'pull_request_review')).not.toThrow()
    expect(formatPayload('application/json', '{"action":"opened"}', 'issues')).not.toBeNull()
  })
  test('push links commits and authors, escapes messages, and links the overflow', () => {
    const commits = Array.from({ length: 12 }, (_, i) => ({
      id: `abcdef${i}0000`,
      url: `https://github.com/me/spk/commit/abcdef${i}`,
      message: i ? 'plain' : 'fix [x](javascript:alert(1)) *bold*\nbody',
      author: { name: 'Al', username: i ? 'al' : undefined },
    }))
    const d = (run('push', { ref: 'refs/heads/main', compare: 'https://github.com/me/spk/compare/a...b', commits }) as { embed: { description: string } }).embed
      .description
    const lines = d.split('\n')
    expect(lines[0]).toBe('[`abcdef0`](https://github.com/me/spk/commit/abcdef0) fix \\[x\\](javascript:alert(1)) \\*bold\\* — Al')
    expect(lines[1]).toBe('[`abcdef1`](https://github.com/me/spk/commit/abcdef1) plain — [Al](https://github.com/al)')
    expect(lines).toHaveLength(11)
    expect(lines[10]).toBe('[+2 more](https://github.com/me/spk/compare/a...b)')
  })
  test('PR card: author, branches, changes, merger and labels', () => {
    const r = run('pull_request', {
      action: 'closed',
      pull_request: {
        number: 3,
        title: 'T',
        merged: true,
        user: { login: 'al', avatar_url: 'https://avatars.githubusercontent.com/u/2' },
        head: { ref: 'feat/x' },
        base: { ref: 'main' },
        additions: 10,
        deletions: 2,
        changed_files: 3,
        merged_by: { login: 'bob', html_url: 'https://github.com/bob' },
        labels: [{ name: 'bug' }],
      },
    })
    expect(r).toMatchObject({
      embed: {
        author: { name: 'al', url: 'https://github.com/al', icon: 'https://avatars.githubusercontent.com/u/2?s=40' },
        fields: [
          { name: 'Branch', value: '[`feat/x`](https://g.dev/me/spk/tree/feat%2Fx) → [`main`](https://g.dev/me/spk/tree/main)' },
          { name: 'Changes', value: '+10 −2 · 3 files' },
          { name: 'Merged by', value: '[bob](https://github.com/bob)' },
          { name: 'Labels', value: '`bug`' },
        ],
      },
    })
  })
  test('workflow run fields', () => {
    const r = run('workflow_run', {
      action: 'completed',
      workflow_run: {
        name: 'CI',
        head_branch: 'main',
        head_sha: 'a'.repeat(40),
        event: 'push',
        conclusion: 'success',
        run_started_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:02:05Z',
        triggering_actor: { login: 'al' },
      },
    })
    expect(r).toMatchObject({
      embed: {
        author: { name: 'al' },
        fields: [
          { name: 'Branch', value: '[`main`](https://g.dev/me/spk/tree/main)' },
          { name: 'Commit', value: `[\`aaaaaaa\`](https://g.dev/me/spk/commit/${'a'.repeat(40)})` },
          { name: 'Trigger', value: 'push' },
          { name: 'Duration', value: '2m 5s' },
        ],
      },
    })
  })
  test('non-https links stay plain text', () => {
    const r = run('push', { ref: 'refs/heads/x', commits: [{ id: 'abc1234', url: 'javascript:alert(1)', message: 'm' }] })
    expect(r).toMatchObject({ embed: { description: '`abc1234` m' } })
  })
  test('payload without a repository', () => {
    expect(formatPayload('application/json', JSON.stringify({ action: 'created', sender }), 'star')).toMatchObject({ embed: { title: '⭐ Starred by bob' } })
  })
})
