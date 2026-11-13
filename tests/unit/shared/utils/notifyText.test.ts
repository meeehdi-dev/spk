import { describe, expect, it } from 'vitest'

import { allowedBy, notificationBody } from '#shared/utils/notifyText'

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

describe('allowedBy', () => {
  it('applies muted channels, the DM switch, and the pings switch', () => {
    expect(allowedBy({ muted: ['t'] }, 't', false)).toBe(false)
    expect(allowedBy({ dms: false }, 'd', true)).toBe(false)
    expect(allowedBy({ pings: false }, 'd', true)).toBe(true)
  })
})
