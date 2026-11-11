/** Plain-text body for a notification: Markdown stripped, mentions as names, spoilers and code hidden. */
export function notificationBody(body: string, nameOf: (userId: string) => string, max = 140): string {
  const text = body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[`~]*[ \t]*$|$(?![\s\S]))/gm, '[code]')
    .replace(/\|\|[\s\S]+?\|\|/g, '[spoiler]')
    .replace(/<@([\w-]+)>/g, (_, id) => `@${nameOf(id)}`)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/^\s{0,3}(?:>\s?|[-*+]\s+|\d+\.\s+|#{1,6}\s+)/gm, '')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
    .replace(/(^|\W)_(\S(?:.*?\S)?)_(?=\W|$)/g, '$1$2')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export interface NotifyPrefs {
  dms?: boolean
  pings?: boolean
  dnd?: boolean
  muted?: string[]
}

/** Whether a DM or a ping (mention/reply in a channel) may notify, given the user's settings. */
export function allowedBy(prefs: NotifyPrefs, channelId: string, isDm: boolean): boolean {
  if (prefs.dnd || prefs.muted?.includes(channelId)) return false
  return isDm ? prefs.dms !== false : prefs.pings !== false
}
