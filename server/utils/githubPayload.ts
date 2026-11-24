import type { Embed } from '../../shared/utils/embed'

// oxlint-disable-next-line typescript/no-explicit-any -- untrusted JSON: every read is optional-chained and sanitized later
type Obj = Record<string, any>
export type GithubResult = Embed | 'skip'

const SKIP: GithubResult = 'skip'
const ALWAYS_SKIP = new Set(['workflow_job', 'check_run', 'check_suite', 'status'])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const excerpt = (v: unknown, n: number) => str(v).trim().slice(0, n) || undefined
// workflow_run.conclusion enum: success | failure | timed_out | startup_failure | cancelled | action_required | stale | skipped | neutral
const CI: Record<string, [string, Embed['color']]> = {
  success: ['✓', 'success'],
  failure: ['✗', 'error'],
  timed_out: ['✗', 'error'],
  startup_failure: ['✗', 'error'],
  cancelled: ['⊘', 'warning'],
  action_required: ['!', 'warning'],
  stale: ['⊘', 'warning'],
}
const COLORS: Record<string, Embed['color']> = { opened: 'info', reopened: 'info', ready_for_review: 'info', merged: 'success', closed: 'error' }

// Field names follow GitHub's webhook schemas (github/rest-api-description, components.schemas.webhook-*).
/** GitHub webhooks → embed, or 'skip' for events not worth a message. Fields are read defensively. */
export function formatGithub(event: string, p: Obj): GithubResult {
  if (ALWAYS_SKIP.has(event)) return SKIP
  const repo = str(p.repository?.name)
  const action = str(p.action)
  const tag = repo ? `[${repo}] ` : ''
  const base = { footer: str(p.sender?.login) || undefined }
  const card = (e: Embed): Embed => ({ ...base, ...e, title: `${tag}${e.title}` })
  const pr = p.pull_request ?? {}
  const issue = p.issue ?? {}

  switch (event) {
    case 'ping':
      return card({ title: 'Webhook connected', description: Array.isArray(p.hook?.events) ? p.hook.events.join(', ') : undefined, color: 'info' })
    case 'push': {
      const commits: Obj[] = Array.isArray(p.commits) ? p.commits : []
      if (!commits.length) return SKIP
      const ref = str(p.ref).replace(/^refs\/(heads|tags)\//, '')
      const lines = commits.slice(0, 5).map(c => `\`${str(c.id).slice(0, 7)}\` ${str(c.message).split('\n')[0]} — ${str(c.author?.name ?? c.author?.username)}`)
      if (commits.length > 5) lines.push(`+${commits.length - 5} more`)
      const n = `${commits.length} ${p.forced ? 'force-pushed commit' : 'new commit'}${commits.length === 1 ? '' : 's'}`
      return {
        ...base,
        title: `[${repo ? `${repo}:` : ''}${ref}] ${n}`,
        description: lines.join('\n'),
        url: p.compare ?? p.head_commit?.url,
        color: p.forced ? 'warning' : 'neutral',
        timestamp: p.head_commit?.timestamp,
      }
    }
    case 'pull_request':
    case 'issues': {
      if (!['opened', 'reopened', 'closed', ...(event === 'pull_request' ? ['ready_for_review'] : [])].includes(action)) return SKIP
      const o = event === 'issues' ? issue : pr
      const what = action === 'closed' && pr.merged && event === 'pull_request' ? 'merged' : action.replaceAll('_', ' ')
      return card({
        title: `${event === 'issues' ? 'Issue' : 'PR'} #${o.number} ${what}: ${str(o.title)}`,
        description: excerpt(o.body, 300),
        url: o.html_url,
        color: COLORS[what === 'merged' ? what : action],
        timestamp: o.updated_at,
      })
    }
    case 'issue_comment':
    case 'pull_request_review_comment': {
      if (action !== 'created') return SKIP
      const o = event === 'issue_comment' ? issue : pr
      return card({
        title: `New comment on #${o.number}: ${str(o.title)}`,
        description: excerpt(p.comment?.body, 300),
        url: p.comment?.html_url,
        color: 'neutral',
        timestamp: p.comment?.created_at,
      })
    }
    case 'pull_request_review': {
      if (action !== 'submitted') return SKIP
      const state = str(p.review?.state).toLowerCase()
      const verb = state === 'approved' ? 'approved' : state === 'changes_requested' ? 'changes requested' : 'reviewed'
      const color = state === 'approved' ? 'success' : state === 'changes_requested' ? 'warning' : 'neutral'
      return card({
        title: `PR #${pr.number} ${verb}`,
        description: excerpt(p.review?.body, 300),
        url: p.review?.html_url ?? pr.html_url,
        color,
        timestamp: p.review?.submitted_at,
      })
    }
    case 'release': {
      if (action !== 'published') return SKIP
      const r = p.release ?? {}
      return card({
        title: `Release ${str(r.name) || str(r.tag_name)} published`,
        description: excerpt(r.body, 500),
        url: r.html_url,
        color: 'success',
        timestamp: r.published_at,
      })
    }
    case 'workflow_run': {
      if (action !== 'completed') return SKIP
      const w = p.workflow_run ?? {}
      const conclusion = str(w.conclusion)
      const [mark, color] = CI[conclusion] ?? ['–', 'neutral'] // skipped, neutral, or unknown
      return card({
        title: `CI ${mark} ${str(w.name)} on ${str(w.head_branch)}${conclusion === 'success' ? '' : ` (${conclusion.replaceAll('_', ' ')})`}`,
        url: w.html_url,
        color,
        timestamp: w.updated_at,
      })
    }
    case 'create':
    case 'delete':
      return card({ title: `${p.ref_type === 'tag' ? 'Tag' : 'Branch'} ${str(p.ref)} ${event}d`, url: p.repository?.html_url, color: 'neutral' })
    case 'star':
      return action === 'created' ? card({ title: `⭐ Starred by ${str(p.sender?.login)}`, url: p.repository?.html_url, color: 'neutral' }) : SKIP
    case 'fork':
      return card({ title: `Forked to ${str(p.forkee?.full_name)}`, url: p.forkee?.html_url, color: 'neutral' })
    default:
      return { title: `\`${event}${action ? `.${action}` : ''}\`${repo ? ` on ${repo}` : ''} (not formatted yet)`, color: 'neutral' }
  }
}
