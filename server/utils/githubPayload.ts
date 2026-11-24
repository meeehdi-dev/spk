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

/** Escapes markdown so payload text can sit inside link text or a description. */
const md = (v: unknown) => str(v).replace(/[\\`*_~[\]<>|#]/g, '\\$&')
const link = (label: string, url: unknown) => (str(url).startsWith('https://') ? `[${label}](${str(url).replace(/[()\s]/g, encodeURIComponent)})` : label)
const profile = (login: unknown) => (str(login) ? `https://github.com/${encodeURIComponent(str(login))}` : '')
const userLink = (u: Obj | undefined) => link(md(u?.login), u?.html_url ?? profile(u?.login))
/** GitHub user → embed author; the avatar is requested at 40px for the 20px slot. */
function author(u: Obj | undefined): Embed['author'] {
  const name = str(u?.login)
  if (!name) return undefined
  const a = URL.parse(str(u?.avatar_url))
  a?.searchParams.set('s', '40')
  return { name, url: str(u?.html_url) || profile(name), icon: a?.href }
}
const list = (items: unknown, f: (x: Obj) => string) => (Array.isArray(items) ? items.map(f).filter(Boolean).join(', ') : '')
const field = (name: string, value: string, inline = true) => (value ? [{ name, value, inline }] : [])
function duration(from: unknown, to: unknown) {
  const s = Math.round((Date.parse(str(to)) - Date.parse(str(from))) / 1000)
  if (!(s >= 0)) return ''
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// Field names follow GitHub's webhook schemas (github/rest-api-description, components.schemas.webhook-*).
/** GitHub webhooks → embed, or 'skip' for events not worth a message. Fields are read defensively. */
export function formatGithub(event: string, p: Obj): GithubResult {
  if (ALWAYS_SKIP.has(event)) return SKIP
  const repo = str(p.repository?.name)
  const repoUrl = str(p.repository?.html_url)
  const tree = (ref: string) => (ref && repoUrl ? `${repoUrl}/tree/${encodeURIComponent(ref)}` : '')
  const action = str(p.action)
  const tag = repo ? `[${repo}] ` : ''
  const base = { footer: str(p.repository?.full_name) || undefined, author: author(p.sender) }
  const card = (e: Embed): Embed => ({ ...base, ...e, title: `${tag}${e.title}` })
  const pr = p.pull_request ?? {}
  const issue = p.issue ?? {}
  const labels = (o: Obj) => list(o.labels, l => `\`${str(l.name).replaceAll('`', '')}\``)

  switch (event) {
    case 'ping':
      return card({ title: 'Webhook connected', description: Array.isArray(p.hook?.events) ? p.hook.events.join(', ') : undefined, color: 'info' })
    case 'push': {
      const commits: Obj[] = Array.isArray(p.commits) ? p.commits : []
      if (!commits.length) return SKIP
      const ref = str(p.ref).replace(/^refs\/(heads|tags)\//, '')
      const lines = commits.slice(0, 10).map(c => {
        const who = c.author?.username ? link(md(c.author?.name || c.author.username), profile(c.author.username)) : md(c.author?.name)
        return `${link(`\`${str(c.id).slice(0, 7)}\``, c.url)} ${md(str(c.message).split('\n')[0])}${who ? ` — ${who}` : ''}`
      })
      if (commits.length > 10) lines.push(link(`+${commits.length - 10} more`, p.compare))
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
      const isPr = event === 'pull_request'
      const o = isPr ? pr : issue
      const what = action === 'closed' && pr.merged && isPr ? 'merged' : action.replaceAll('_', ' ')
      const changes = typeof pr.additions === 'number' ? `+${pr.additions} −${pr.deletions ?? 0} · ${pr.changed_files ?? 0} files` : ''
      return card({
        author: author(o.user) ?? base.author,
        title: `${isPr ? (pr.draft ? 'Draft PR' : 'PR') : 'Issue'} #${o.number} ${what}: ${str(o.title)}`,
        description: excerpt(o.body, 300),
        url: o.html_url,
        color: pr.draft && isPr ? 'neutral' : COLORS[what === 'merged' ? what : action],
        fields: [
          ...(isPr && pr.head?.ref
            ? field('Branch', `${link(`\`${md(pr.head.ref)}\``, tree(str(pr.head.ref)))} → ${link(`\`${md(pr.base?.ref)}\``, tree(str(pr.base?.ref)))}`)
            : []),
          ...(isPr ? field('Changes', changes) : []),
          ...(what === 'merged' ? field('Merged by', userLink(pr.merged_by)) : []),
          ...field('Labels', labels(o)),
          ...(isPr ? [] : field('Assignees', list(o.assignees, userLink))),
        ],
        timestamp: o.updated_at,
      })
    }
    case 'issue_comment':
    case 'pull_request_review_comment': {
      if (action !== 'created') return SKIP
      const o = event === 'issue_comment' ? issue : pr
      return card({
        author: author(p.comment?.user) ?? base.author,
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
        author: author(p.review?.user) ?? base.author,
        title: `PR #${pr.number} ${verb}${pr.title ? `: ${str(pr.title)}` : ''}`,
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
        author: author(r.author) ?? base.author,
        title: `${r.prerelease ? 'Pre-release' : 'Release'} ${str(r.name) || str(r.tag_name)} published`,
        description: excerpt(r.body, 500),
        url: r.html_url,
        color: r.prerelease ? 'warning' : 'success',
        fields: field('Tag', link(`\`${md(r.tag_name)}\``, tree(str(r.tag_name)))),
        timestamp: r.published_at,
      })
    }
    case 'workflow_run': {
      if (action !== 'completed') return SKIP
      const w = p.workflow_run ?? {}
      const conclusion = str(w.conclusion)
      const [mark, color] = CI[conclusion] ?? ['–', 'neutral'] // skipped, neutral, or unknown
      const sha = str(w.head_sha)
      return card({
        author: author(w.triggering_actor ?? w.actor) ?? base.author,
        title: `CI ${mark} ${str(w.name)} on ${str(w.head_branch)}${conclusion === 'success' ? '' : ` (${conclusion.replaceAll('_', ' ')})`}`,
        url: w.html_url,
        color,
        fields: [
          ...field('Branch', w.head_branch ? link(`\`${md(w.head_branch)}\``, tree(str(w.head_branch))) : ''),
          ...field('Commit', sha ? link(`\`${sha.slice(0, 7)}\``, repoUrl && `${repoUrl}/commit/${sha}`) : ''),
          ...field('Trigger', md(w.event)),
          ...field('Duration', duration(w.run_started_at, w.updated_at)),
        ],
        timestamp: w.updated_at,
      })
    }
    case 'create':
    case 'delete':
      return card({
        title: `${p.ref_type === 'tag' ? 'Tag' : 'Branch'} ${str(p.ref)} ${event}d`,
        url: (event === 'create' && tree(str(p.ref))) || repoUrl || undefined,
        color: 'neutral',
      })
    case 'star':
      return action === 'created'
        ? card({
            title: `⭐ Starred by ${str(p.sender?.login)}`,
            url: repoUrl || undefined,
            color: 'neutral',
            fields: field('Stars', typeof p.repository?.stargazers_count === 'number' ? String(p.repository.stargazers_count) : ''),
          })
        : SKIP
    case 'fork':
      return card({ title: `Forked to ${str(p.forkee?.full_name)}`, url: p.forkee?.html_url, color: 'neutral' })
    default:
      return { title: `\`${event}${action ? `.${action}` : ''}\`${repo ? ` on ${repo}` : ''} (not formatted yet)`, color: 'neutral' }
  }
}
