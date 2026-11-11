/**
 * The one list behind the `?` overlay and Settings → Shortcuts. Keep it in sync with the real bindings:
 * `where` names the file that wires each entry. `planned` marks an entry with no binding yet (none right now).
 */
interface ShortcutEntry {
  keys: string[]
  label: string
  planned?: boolean
  where?: string
}
export interface ShortcutGroup {
  title: string
  items: ShortcutEntry[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['meta', 'K'], label: 'Quick switcher (channels, DMs, people)', where: 'layouts/default.vue' },
      { keys: ['alt', 'arrowup'], label: 'Previous channel', where: 'layouts/default.vue' },
      { keys: ['alt', 'arrowdown'], label: 'Next channel', where: 'layouts/default.vue' },
      { keys: ['alt', 'shift', 'arrowup'], label: 'Previous unread channel', where: 'layouts/default.vue' },
      { keys: ['alt', 'shift', 'arrowdown'], label: 'Next unread channel', where: 'layouts/default.vue' },
      { keys: ['meta', 'B'], label: 'Show / hide the sidebar (not while typing in a text field: there it is Bold)', where: 'layouts/default.vue' },
      { keys: ['?'], label: 'Show all shortcuts', where: 'layouts/default.vue' },
    ],
  },
  {
    title: 'Messages',
    items: [
      { keys: ['arrowup'], label: 'Edit your last message (empty input)', where: 'MessageInput.vue' },
      { keys: ['R'], label: 'Reply (message focused)', where: 'ChatMessage.vue' },
      { keys: ['escape'], label: 'Mark channel as read, cancel an edit or reply, close search', where: 'ChannelView.vue' },
      { keys: ['enter'], label: 'Send', where: 'editor-extensions.ts' },
      { keys: ['shift', 'enter'], label: 'New line', where: 'editor-extensions.ts' },
    ],
  },
  {
    title: 'Search',
    items: [
      { keys: ['/'], label: 'Focus the search box (not while typing in a text field)', where: 'layouts/default.vue' },
      { keys: ['escape'], label: 'Leave the search box', where: 'layouts/default.vue' },
      { keys: ['meta', 'shift', 'F'], label: 'Search everything', where: 'layouts/default.vue' },
      { keys: ['arrowup'], label: 'Previous result (in search)', where: 'SearchPanel.vue' },
      { keys: ['arrowdown'], label: 'Next result (in search)', where: 'SearchPanel.vue' },
      { keys: ['enter'], label: 'Open result (in search)', where: 'SearchPanel.vue' },
    ],
  },
  {
    title: 'Formatting (in the input)',
    items: [
      { keys: ['meta', 'B'], label: 'Bold' },
      { keys: ['meta', 'I'], label: 'Italic' },
      { keys: ['meta', 'shift', 'X'], label: 'Strikethrough' },
      { keys: ['meta', 'E'], label: 'Inline code' },
      // Ctrl/⌘ Shift C is the inspector in Chrome and Firefox (decision 11); both work, Alt C is the one to use.
      { keys: ['meta', 'alt', 'C'], label: 'Code block (Ctrl/⌘ Shift C also works where the browser allows it)' },
      { keys: ['meta', 'shift', '.'], label: 'Quote' },
    ],
  },
  {
    // Ctrl/⌘ Shift M / D are kept by the browsers (decision 11), so mute and deafen add Alt (Alt alone clashes with ⌘⌥M minimize, ⌘⌥D Dock, Ctrl Alt L lock).
    title: 'Voice and video',
    items: [
      { keys: ['meta', 'alt', 'shift', 'M'], label: 'Mute / unmute', where: 'layouts/default.vue' },
      { keys: ['meta', 'alt', 'shift', 'D'], label: 'Deafen / undeafen', where: 'layouts/default.vue' },
      // Ctrl Shift E / S open dev tools and the screenshot tool in Firefox (decision 11), so camera and screen share use the same three modifiers as mute.
      { keys: ['meta', 'alt', 'shift', 'E'], label: 'Camera on / off', where: 'layouts/default.vue' },
      { keys: ['meta', 'alt', 'shift', 'S'], label: 'Screen share (start / stop)', where: 'layouts/default.vue' },
      { keys: ['meta', 'alt', 'shift', 'N'], label: 'Cycle noise suppression (Off / Standard / Enhanced)', where: 'layouts/default.vue' },
      { keys: ['meta', 'alt', 'shift', 'O'], label: 'Echo cancellation on / off', where: 'layouts/default.vue' },
      { keys: ['meta', 'alt', 'shift', 'G'], label: 'Auto gain on / off', where: 'layouts/default.vue' },
      { keys: ['T'], label: 'Theater mode (hovered or focused tile)', where: 'components/VoiceTile.vue' },
      { keys: ['F'], label: 'Fullscreen (hovered or focused tile)', where: 'components/VoiceTile.vue' },
      { keys: ['W'], label: 'Watch / stop watching (hovered or focused tile)', where: 'components/VoiceTile.vue' },
    ],
  },
]

/** Id of the channel `step` places away from `current` (wraps around); the first or last one when `current` isn't in the list. */
export function stepChannel(ids: string[], current: string | undefined, step: 1 | -1): string | undefined {
  if (!ids.length) return undefined
  const i = current ? ids.indexOf(current) : -1
  if (i < 0) return step === 1 ? ids[0] : ids.at(-1)
  return ids[(i + step + ids.length) % ids.length]
}

/** Same, but only channels with unread messages count (the current one never matches itself). */
export function stepUnread(ids: string[], current: string | undefined, step: 1 | -1, isUnread: (id: string) => boolean): string | undefined {
  const i = current ? ids.indexOf(current) : -1
  for (let n = 1; n <= ids.length; n++) {
    const id = ids[i < 0 ? (step === 1 ? n - 1 : ids.length - n) : (((i + step * n) % ids.length) + ids.length) % ids.length]!
    if (id !== current && isUnread(id)) return id
  }
  return undefined
}
