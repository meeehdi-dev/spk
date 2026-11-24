import type { Embed } from '#shared/utils/embed'

import { formatPayload } from '~~/server/utils/webhookPayload'

// Realistic GitHub payloads run through the real formatter, so the sandbox shows production output.
const repository = { name: 'spk', full_name: 'meeehdi-dev/spk', html_url: 'https://github.com/meeehdi-dev/spk', stargazers_count: 42 }
const user = (login: string) => ({ login, html_url: `https://github.com/${login}`, avatar_url: `https://avatars.githubusercontent.com/${login}` })
const me = user('meeehdi-dev')
const octo = user('octocat')
const commit = (id: string, message: string) => ({
  id: id.padEnd(40, '0'),
  url: `https://github.com/meeehdi-dev/spk/commit/${id.padEnd(40, '0')}`,
  message,
  author: { name: 'Mehdi', username: 'meeehdi-dev' },
})
const t = (min: number) => new Date(Date.UTC(2026, 0, 15, 12, min)).toISOString()

const events: [string, object][] = [
  [
    'push',
    {
      ref: 'refs/heads/main',
      compare: 'https://github.com/meeehdi-dev/spk/compare/acf2a89...bde02dd',
      head_commit: { timestamp: t(0) },
      commits: [
        commit('7aff7f1', 'feat(bot): add spk bot that answers mentions with Claude Haiku'),
        commit('1106ddf', 'style(ui): drop focus rings and floating panel borders'),
        commit('2403d82', 'style(sidebar): show voice status icons next to the user name'),
        commit('31e945b', 'feat(soundboard): flag new sounds on the soundboard button'),
        commit('8b8b6af', 'style(chat): align message input gutter with sidebar panels'),
        ...Array.from({ length: 7 }, (_, i) => commit(`c0ffee${i}`, `chore: tidy up part ${i + 1}`)),
      ],
    },
  ],
  [
    'pull_request',
    {
      action: 'opened',
      pull_request: {
        number: 128,
        title: 'feat(webhooks): richer GitHub cards',
        body: 'Adds author avatars, commit links and **PR details** to GitHub webhook messages.',
        html_url: 'https://github.com/meeehdi-dev/spk/pull/128',
        user: octo,
        head: { ref: 'feat/github-cards' },
        base: { ref: 'main' },
        additions: 214,
        deletions: 37,
        changed_files: 6,
        labels: [{ name: 'enhancement' }, { name: 'webhooks' }],
        updated_at: t(5),
      },
    },
  ],
  [
    'pull_request',
    {
      action: 'closed',
      pull_request: {
        number: 127,
        title: 'fix(voice): reconnect after network change',
        merged: true,
        html_url: 'https://github.com/meeehdi-dev/spk/pull/127',
        user: me,
        merged_by: octo,
        head: { ref: 'fix/voice-reconnect' },
        base: { ref: 'main' },
        additions: 12,
        deletions: 4,
        changed_files: 2,
        updated_at: t(10),
      },
    },
  ],
  [
    'issues',
    {
      action: 'opened',
      issue: {
        number: 64,
        title: 'Soundboard volume resets after reload',
        body: 'Steps:\n1. Lower the volume\n2. Reload the page',
        html_url: 'https://github.com/meeehdi-dev/spk/issues/64',
        user: octo,
        labels: [{ name: 'bug' }],
        assignees: [me],
        updated_at: t(15),
      },
    },
  ],
  [
    'pull_request_review',
    {
      action: 'submitted',
      pull_request: { number: 128, title: 'feat(webhooks): richer GitHub cards', html_url: 'https://github.com/meeehdi-dev/spk/pull/128' },
      review: {
        state: 'approved',
        body: 'Looks great 🚀',
        user: me,
        submitted_at: t(20),
        html_url: 'https://github.com/meeehdi-dev/spk/pull/128#pullrequestreview-1',
      },
    },
  ],
  [
    'workflow_run',
    {
      action: 'completed',
      workflow_run: {
        name: 'CI',
        head_branch: 'main',
        head_sha: 'bde02dd'.padEnd(40, '0'),
        event: 'push',
        conclusion: 'failure',
        html_url: 'https://github.com/meeehdi-dev/spk/actions/runs/1',
        run_started_at: t(21),
        updated_at: t(24),
        triggering_actor: me,
      },
    },
  ],
  [
    'release',
    {
      action: 'published',
      release: {
        name: 'v1.4.0',
        tag_name: 'v1.4.0',
        body: '## Highlights\n- Richer webhook cards\n- Soundboard fixes',
        html_url: 'https://github.com/meeehdi-dev/spk/releases/tag/v1.4.0',
        author: me,
        published_at: t(30),
      },
    },
  ],
  ['star', { action: 'created', sender: octo }],
]

export const githubEmbeds = (): Embed[] =>
  events.flatMap(([event, p]) => {
    const r = formatPayload('application/json', JSON.stringify({ repository, sender: me, ...p }), event)
    return r && r !== 'skip' && r.embed ? [r.embed] : []
  })
