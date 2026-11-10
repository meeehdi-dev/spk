import type { MDCRoot } from '@nuxtjs/mdc'

let processor: Promise<{ process: (f: { value: string }) => Promise<{ result: { body: MDCRoot } }> }> | undefined
const cache = new Map<string, MDCRoot>()

/** Markdown -> MDC tree. No front matter, no MDC component syntax, no raw HTML (see shared/utils/markdown.ts). */
export async function parseChatMarkdown(body: string): Promise<MDCRoot> {
  const hit = cache.get(body)
  if (hit) return hit
  processor ??= import('@nuxtjs/mdc/runtime').then(m => m.createParseProcessor({
    remark: { plugins: { 'remark-mdc': false, 'spk': { instance: remarkSpk } } },
    highlight: false,
    toc: false
  }) as never)
  const file = await (await processor).process({ value: body })
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  cache.set(body, file.result.body)
  return file.result.body
}
