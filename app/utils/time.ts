/** "just now", "2 min ago", "3 h ago", else "Nov 8". */
export function relativeTime(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} d ago`
}

export const exactTime = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })
export const clockTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "Today", "Yesterday", "Nov 8" (with the year when it isn't this year). */
export function dayLabel(ts: number, now = Date.now()) {
  const d = new Date(ts)
  const today = new Date(now)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(
    [],
    d.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' },
  )
}

export const dayKey = (ts: number) => new Date(ts).toDateString()

export const GROUP_MS = 5 * 60_000
