import { Extension, Mark, markInputRule, mergeAttributes } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'

const MENTION_TOKEN = /^<@([\w-]+)>/

/** Mention node that reads and writes `<@userId>`; the label is the user's current nickname. */
export const SpkMention = Mention.extend<{ getLabel?: (id: string) => string | undefined }>({
  markdownTokenName: 'spkMention',
  markdownTokenizer: {
    name: 'spkMention',
    level: 'inline',
    start: (src: string) => src.indexOf('<@'),
    tokenize(src: string) {
      const m = MENTION_TOKEN.exec(src)
      return m ? { type: 'spkMention', raw: m[0], id: m[1] } : undefined
    }
  },
  parseMarkdown(token: any, h: any) {
    return h.createNode('mention', { id: token.id, label: this.options.getLabel?.(token.id) ?? token.id })
  },
  renderMarkdown: (node: any) => `<@${node.attrs?.id}>`
})

/** `||hidden||` mark, shown blurred until clicked. */
export const Spoiler = Mark.create({
  name: 'spoiler',
  markdownTokenName: 'spoiler',
  markdownTokenizer: {
    name: 'spoiler',
    level: 'inline',
    start: (src: string) => src.indexOf('||'),
    tokenize(src: string, _tokens: any, lexer: any) {
      const m = /^\|\|(?=\S)([\s\S]*?\S)\|\|/.exec(src)
      return m ? { type: 'spoiler', raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]!) } : undefined
    }
  },
  parseMarkdown(token: any, h: any) {
    // The parser only marks text nodes; mentions inside a spoiler need the mark added by hand.
    const content = h.parseInline(token.tokens || []).map((n: any) =>
      n.type === 'mention' ? { ...n, marks: [...(n.marks || []), { type: 'spoiler' }] } : n)
    return h.applyMark('spoiler', content)
  },
  renderMarkdown: (node: any, h: any) => `||${h.renderChildren(node)}||`,
  parseHTML: () => [{ tag: 'span[data-spoiler]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes({ 'data-spoiler': '' }, HTMLAttributes), 0],
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)\|\|([^|\s][^|]*)\|\|$/, type: this.type })]
  }
})

// shortcut: a spoiler holding only a mention loses the spoiler on serialize (the mark never opens), fix if it matters.
/**
 * TipTap's serializer closes a mark before an inline node and reopens it after, so a mention inside a
 * spoiler comes out as `||a ||<@id>||`. Merge those seams back into `||a <@id>||`.
 */
export const fixSpoilerSeams = (md: string) => md.replace(/(\|\|[^|\n]+?)\|\|(<@[\w-]+>)\|\|/g, '$1$2||')

/**
 * Key handling shared by the message input and the inline editor: Enter submits (a new line inside a code block),
 * Shift+Enter is a line break. Shift+Ctrl/Cmd+C is the browser's inspector in Chrome and Firefox, so the code
 * block also answers to Ctrl/Cmd+Alt+C.
 */
/** A line that is exactly ``` plus an optional language (```json). Returns the language ('' if none), or null when the line isn't a fence. */
export const fenceLanguage = (line: string) => /^```([\w+#.-]*)$/.exec(line)?.[1] ?? null

export const chatKeys = (o: { onEnter: () => void, onEscape?: () => boolean, onArrowUp?: () => boolean }) => Extension.create({
  name: 'chatKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.isActive('codeBlock')) return false
        // ```lang + Enter on the last line (after a Shift+Enter break too) makes a code block instead of sending.
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parent.type.name !== 'paragraph') return o.onEnter(), true
        let breakAt = -1
        let line = ''
        $from.parent.forEach((n, off) => {
          if (n.type.name === 'hardBreak') breakAt = $from.start() + off, line = ''
          else line += n.isText ? n.text : '\0'
        })
        const lang = fenceLanguage(line)
        if (lang === null) return o.onEnter(), true
        const c = editor.chain().command(({ tr }) => { tr.delete(breakAt >= 0 ? breakAt : $from.start(), $from.end()); return true })
        if (breakAt >= 0) c.splitBlock()
        return c.setCodeBlock(lang ? { language: lang } : undefined).run()
      },
      'Escape': () => o.onEscape?.() ?? false,
      'ArrowUp': ({ editor }) => editor.isEmpty && (o.onArrowUp?.() ?? false),
      'Mod-Shift-c': ({ editor }) => editor.commands.toggleCodeBlock(),
      'Mod-Alt-c': ({ editor }) => editor.commands.toggleCodeBlock(),
      'Mod-Shift-.': ({ editor }) => editor.commands.toggleBlockquote(),
      'Mod-Shift->': ({ editor }) => editor.commands.toggleBlockquote(),
      'Mod-Shift-x': ({ editor }) => editor.commands.toggleStrike()
    }
  }
})

/** Mention node (labels follow current nicknames) + spoiler mark. */
export const chatMarkExtensions = (getLabel: (id: string) => string | undefined) => [
  SpkMention.configure({
    HTMLAttributes: { class: 'mention' },
    getLabel,
    renderText: ({ node }: any) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }: any) => ['span', { 'data-type': 'mention', ...options.HTMLAttributes }, `@${node.attrs.label ?? node.attrs.id}`]
  } as never),
  Spoiler
]
