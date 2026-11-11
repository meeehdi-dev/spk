// Attachment rules shared by the server (presign) and the client (upload queue, cards).

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_FILES = 10
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024
export const TEXT_PREVIEW_RANGE = 64 * 1024

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i

/** A well-formed `type/subtype` (lower-cased), or null. Parameters like `; charset=` are not accepted. */
export const cleanMime = (v: unknown): string | null => (typeof v === 'string' && MIME_RE.test(v) ? v.toLowerCase() : null)

/** "20 MB", "1.5 MB", "300 B" (1024-based steps, localized number). */
export function formatBytes(n: number) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return new Intl.NumberFormat([], { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: i ? 1 : 0 }).format(n)
}

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

const CODE_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  json: 'json',
  py: 'python',
  vue: 'vue',
  css: 'css',
  html: 'html',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  toml: 'toml',
  ini: 'ini',
  diff: 'diff',
  md: 'markdown',
}
const TEXT_EXT = new Set(['txt', 'log', 'csv', 'conf', 'env'])

/** Shiki language for text/code files we preview, else null. */
export const previewLanguage = (filename: string, size: number): string | null => {
  if (size >= TEXT_PREVIEW_MAX_BYTES) return null
  const e = ext(filename)
  return CODE_EXT[e] ?? (TEXT_EXT.has(e) ? 'text' : null)
}

/** Lucide icon for a file (PLAN.md §6). */
export function fileIcon(mime: string, filename: string) {
  const e = ext(filename)
  if (mime.startsWith('image/')) return 'i-lucide-file-image'
  if (mime.startsWith('video/')) return 'i-lucide-file-video'
  if (mime.startsWith('audio/')) return 'i-lucide-file-audio'
  if (/zip|gzip|x-tar|x-7z|rar|compressed/.test(mime) || ['zip', 'gz', 'tar', '7z', 'rar', 'tgz'].includes(e)) return 'i-lucide-file-archive'
  if (/spreadsheet|ms-excel|csv/.test(mime) || ['xls', 'xlsx', 'ods', 'csv'].includes(e)) return 'i-lucide-file-spreadsheet'
  if (e in CODE_EXT && e !== 'md') return 'i-lucide-file-code'
  if (mime === 'application/pdf' || mime.startsWith('text/') || ['pdf', 'txt', 'md', 'log'].includes(e)) return 'i-lucide-file-text'
  return 'i-lucide-file'
}
