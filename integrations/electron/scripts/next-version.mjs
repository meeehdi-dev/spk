// CI: decide whether the desktop app needs a release and which version.
// Writes `release`, `version` and `notes` to $GITHUB_OUTPUT (or stdout). Run from integrations/electron.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const TAG_PREFIX = 'desktop-v'
const RELEASE_COMMIT = /^chore\(desktop\): release /

const bumpOf = subjects => {
  if (subjects.some(s => /^\w+(\([^)]*\))?!:/.test(s))) return 'breaking'
  if (subjects.some(s => /^feat(\([^)]*\))?:/.test(s))) return 'minor'
  return 'patch'
}

const increment = (version, bump) => {
  const [major, minor, patch] = version.split('.').map(Number)
  // Before 1.0, breaking changes bump the minor version.
  if (bump === 'breaking' && major > 0) return `${major + 1}.0.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  return `${major}.${minor + 1}.0`
}

/**
 * @param {{ lastTag: string | null, current: string, commits: { sha: string, subject: string }[] }} input
 * @returns {{ release: boolean, version: string, notes: string }}
 */
export function nextVersion({ lastTag, current, commits }) {
  const changes = commits.filter(c => !RELEASE_COMMIT.test(c.subject))
  const notes = changes.map(c => `- ${c.subject} (${c.sha})`).join('\n')
  if (!lastTag) return { release: true, version: current, notes }
  const released = lastTag.slice(TAG_PREFIX.length)
  // A bump was committed but its release failed: release it as is.
  if (current !== released) return { release: true, version: current, notes }
  if (!changes.length) return { release: false, version: current, notes }
  return { release: true, version: increment(released, bumpOf(changes.map(c => c.subject))), notes }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let lastTag = null
  try {
    lastTag = git('describe', '--tags', '--abbrev=0', '--match', `${TAG_PREFIX}*`)
  } catch {
    // no desktop release yet
  }
  const range = lastTag ? [`${lastTag}..HEAD`] : []
  const log = git('log', '--format=%h %s', ...range, '--', '.', ':(exclude)*.md')
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map(line => ({ sha: line.slice(0, line.indexOf(' ')), subject: line.slice(line.indexOf(' ') + 1) }))
  const { version: current } = JSON.parse(readFileSync('package.json', 'utf8'))
  const result = nextVersion({ lastTag, current, commits })
  const output = `release=${result.release}\nversion=${result.version}\nnotes<<EOF_NOTES\n${result.notes}\nEOF_NOTES\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
  else process.stdout.write(output)
}
