import type { MentionOptions } from '@tiptap/extension-mention'
import type { VNode } from 'vue'

import { Extension, Mark, markInputRule, mergeAttributes } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { VueRenderer } from '@tiptap/vue-3'
import { defineComponent, h } from 'vue'

import { splitEmojis } from '#shared/utils/markdown'
import EmojiGlyph from '~/components/mdc/EmojiGlyph.vue'
import { twemojiSrc } from '~/utils/twemoji'

const MentionLabel = defineComponent({
  props: { text: { type: String, required: true }, code: Boolean },
  setup: props => (): VNode =>
    h(
      'span',
      { class: 'mention', 'data-type': 'mention' },
      props.code ? props.text : splitEmojis(props.text).map((part, i) => (i % 2 ? h(EmojiGlyph, { emoji: part }) : part)),
    ),
})

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
    },
  },
  parseMarkdown(token, h) {
    return h.createNode('mention', { id: token.id, label: this.options.getLabel?.(token.id) ?? token.id })
  },
  renderMarkdown: node => `<@${node.attrs?.id}>`,
  addNodeView() {
    return ({ node, editor }) => {
      const props = (n: typeof node) => ({ text: `@${n.attrs.label ?? n.attrs.id}`, code: n.marks.some(mark => mark.type.spec.code) })
      const renderer = new VueRenderer(MentionLabel, { editor, props: props(node) })
      return {
        dom: renderer.element as HTMLElement,
        update(next) {
          if (next.type !== node.type) return false
          renderer.updateProps(props(next))
          return true
        },
        destroy: () => renderer.destroy(),
      }
    }
  },
})

/** `||hidden||` mark, shown blurred until clicked. */
export const Spoiler = Mark.create({
  name: 'spoiler',
  markdownTokenName: 'spoiler',
  markdownTokenizer: {
    name: 'spoiler',
    level: 'inline',
    start: (src: string) => src.indexOf('||'),
    tokenize(src: string, _tokens, lexer) {
      const m = /^\|\|(?=\S)([\s\S]*?\S)\|\|/.exec(src)
      return m ? { type: 'spoiler', raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]!) } : undefined
    },
  },
  parseMarkdown(token, h) {
    // The parser only marks text nodes; mentions inside a spoiler need the mark added by hand.
    const content = h.parseInline(token.tokens || []).map(n => (n.type === 'mention' ? { ...n, marks: [...(n.marks || []), { type: 'spoiler' }] } : n))
    return h.applyMark('spoiler', content)
  },
  renderMarkdown: (node, h) => `||${h.renderChildren(node)}||`,
  parseHTML: () => [{ tag: 'span[data-spoiler]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes({ 'data-spoiler': '' }, HTMLAttributes), 0],
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)\|\|([^|\s][^|]*)\|\|$/, type: this.type })]
  },
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

export const chatKeys = (o: { onEnter: () => void; onEscape?: () => boolean; onArrowUp?: () => boolean }) =>
  Extension.create({
    name: 'chatKeys',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          // Code blocks and list items keep Enter for themselves (new line / next item, an empty item leaves the list).
          if (editor.isActive('codeBlock') || editor.isActive('listItem')) return false
          // ```lang + Enter on the last line (after a Shift+Enter break too) makes a code block instead of sending.
          const { $from, empty } = editor.state.selection
          if (!empty || $from.parent.type.name !== 'paragraph') return (o.onEnter(), true)
          let breakAt = -1
          let line = ''
          $from.parent.forEach((n, off) => {
            if (n.type.name === 'hardBreak') {
              breakAt = $from.start() + off
              line = ''
            } else line += n.isText ? n.text : '\0'
          })
          const lang = fenceLanguage(line)
          if (lang === null) return (o.onEnter(), true)
          const c = editor.chain().command(({ tr }) => {
            tr.delete(breakAt >= 0 ? breakAt : $from.start(), $from.end())
            return true
          })
          if (breakAt >= 0) c.splitBlock()
          return c.setCodeBlock(lang ? { language: lang } : undefined).run()
        },
        Escape: () => o.onEscape?.() ?? false,
        ArrowUp: ({ editor }) => editor.isEmpty && (o.onArrowUp?.() ?? false),
        'Mod-Shift-c': ({ editor }) => editor.commands.toggleCodeBlock(),
        'Mod-Alt-c': ({ editor }) => editor.commands.toggleCodeBlock(),
        'Mod-Shift-.': ({ editor }) => editor.commands.toggleBlockquote(),
        'Mod-Shift->': ({ editor }) => editor.commands.toggleBlockquote(),
        'Mod-Shift-x': ({ editor }) => editor.commands.toggleStrike(),
      }
    },
  })

/** Shows the code block's language (or "plain text") as `data-language` on its `<pre>`; CSS draws it in the corner. */
const CodeLanguageLabel = Extension.create({
  name: 'codeLanguageLabel',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: ({ doc }) => {
            const decos: Decoration[] = []
            doc.descendants((node, pos) => {
              if (node.type.name === 'codeBlock')
                decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-language': node.attrs.language || 'plain text' }))
            })
            return DecorationSet.create(doc, decos)
          },
        },
      }),
    ]
  },
})

/** View-only glyphs: the text stays in ProseMirror for selection, editing and clipboard serialization. */
const EditorEmoji = Extension.create({
  name: 'editorEmoji',
  addProseMirrorPlugins() {
    const editor = this.editor
    const key = new PluginKey<DecorationSet>('editorEmoji')
    const artwork = new Map<string, HTMLImageElement>()
    const loaded = new Set<string>()
    const load = (emoji: string) => {
      if (artwork.has(emoji)) return
      const image = new Image()
      artwork.set(emoji, image)
      image.onload = () => {
        loaded.add(emoji)
        if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, true))
      }
      image.src = twemojiSrc(emoji)
    }
    const decorate = (doc: typeof editor.state.doc) => {
      const decorations: Decoration[] = []
      doc.descendants((node, pos) => {
        if (node.type.spec.code) return false
        if (!node.isText || node.marks.some(mark => mark.type.spec.code)) return
        let from = pos
        for (const [i, part] of splitEmojis(node.text!).entries()) {
          const to = from + part.length
          if (i % 2) {
            load(part)
            // Paint on the text span itself so artwork follows wrapping and bidirectional text.
            if (loaded.has(part))
              decorations.push(
                Decoration.inline(from, to, {
                  'data-emoji': part,
                  style: `display: inline-block; width: 1em; color: transparent; caret-color: var(--ui-text); text-shadow: none; background: url("${twemojiSrc(part)}") center / contain no-repeat;`,
                }),
              )
          }
          from = to
        }
      })
      return DecorationSet.create(doc, decorations)
    }
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, decorations) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : decorations),
        },
        props: { decorations: state => key.getState(state) },
        view: () => ({
          destroy() {
            for (const image of artwork.values()) image.onload = null
            artwork.clear()
          },
        }),
      }),
    ]
  },
})

/** Mention node (labels follow current nicknames) + spoiler mark and view-only emoji. */
export const chatMarkExtensions = (getLabel: (id: string) => string | undefined) => [
  SpkMention.configure({
    HTMLAttributes: { class: 'mention' },
    getLabel,
    renderText: ({ node }: Parameters<MentionOptions['renderText']>[0]) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }: Parameters<MentionOptions['renderHTML']>[0]) => [
      'span',
      { 'data-type': 'mention', ...options.HTMLAttributes },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
  } as never),
  Spoiler,
  CodeLanguageLabel,
  EditorEmoji,
]
