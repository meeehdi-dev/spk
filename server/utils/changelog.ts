interface GitHubCommit {
  sha: string
  commit: { message: string; committer: { date: string } }
}

export const fetchChangelog = defineCachedFunction(
  async (page: number, head: string) => {
    const response = await $fetch.raw<GitHubCommit[]>('https://api.github.com/repos/meeehdi-dev/spk/commits', {
      query: { sha: head, page, per_page: 50 },
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'spk-changelog' },
      timeout: 5000,
      retry: 0,
    })
    const data = response._data
    if (!Array.isArray(data) || data.length > 50) throw new Error('Invalid commit list')
    const commits = data.map(item => {
      if (
        !item ||
        typeof item.sha !== 'string' ||
        !/^[a-f0-9]{40}$/.test(item.sha) ||
        typeof item.commit?.message !== 'string' ||
        typeof item.commit?.committer?.date !== 'string' ||
        !Number.isFinite(Date.parse(item.commit.committer.date))
      )
        throw new Error('Invalid commit')
      return {
        sha: item.sha,
        message: item.commit.message.split(/\r?\n/, 1)[0]!,
        date: new Date(item.commit.committer.date).toISOString().slice(0, 10),
      }
    })
    return {
      commits,
      head: head === 'main' ? (commits[0]?.sha ?? null) : head,
      nextPage: response.headers.get('link')?.includes('rel="next"') ? page + 1 : null,
    }
  },
  { name: 'changelog', maxAge: 300, swr: false },
)
