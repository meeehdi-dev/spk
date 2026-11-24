/** A rich card attached to a webhook message (validated on the server before it is stored). */
export interface Embed {
  title?: string
  description?: string
  url?: string
  color?: 'success' | 'error' | 'warning' | 'info' | 'neutral'
  fields?: { name: string; value: string; inline?: boolean }[]
  footer?: string
  timestamp?: string
}
