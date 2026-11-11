import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const common = { javascript, typescript, python, bash, json, xml, css, sql, yaml, go, rust, java, c, cpp, csharp, php, ruby, diff }
for (const [name, def] of Object.entries(common)) hljs.registerLanguage(name, def)

/** hljs name -> Shiki id (they differ for xml). */
const toShiki: Record<string, string> = { xml: 'html' }

export const PLAIN_ABOVE_LINES = 1000
const AUTO_MIN_LINES = 5

/** Guess a language for an unlabelled block. Short blocks stay plain text. */
export function detectLanguage(code: string): string | null {
  if (code.split('\n').length < AUTO_MIN_LINES) return null
  const r = hljs.highlightAuto(code, Object.keys(common))
  return r.language && r.relevance >= 5 ? (toShiki[r.language] ?? r.language) : null
}

const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', yml: 'yaml', rs: 'rust', cs: 'csharp', md: 'markdown', text: 'text', txt: 'text', plain: 'text' }

/** Shiki HTML with one `.line` span per line (CSS adds the line numbers), or null when the language is unknown. */
export async function highlightToHtml(code: string, lang: string): Promise<string | null> {
  const { bundledLanguages, codeToHtml } = await import('shiki')
  const id = aliases[lang] ?? lang
  if (!(id in bundledLanguages)) return null
  return codeToHtml(code, { lang: id, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false })
}

export async function languageList(): Promise<string[]> {
  const { bundledLanguages } = await import('shiki')
  return ['text', ...Object.keys(bundledLanguages).filter(l => l !== 'text')]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Same markup shape as Shiki's output, without colors (used until/unless highlighting is available). */
export const plainHtml = (code: string) =>
  `<pre><code>${code.split('\n').map(l => `<span class="line">${esc(l) || ' '}</span>`).join('\n')}</code></pre>`
