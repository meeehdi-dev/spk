/** Search panel state, shared by the layout (shortcuts, header button) and the panel. */
export function useSearch() {
  const s = useState('search', () => ({ open: false, q: '', scope: 'channels' as 'channel' | 'channels' | 'dms' | 'everything', focusTick: 0 }))
  return reactive({
    ...toRefs(s.value),
    /** Open (or refocus) the panel with a scope. */
    show(scope: 'channel' | 'everything') {
      s.value.scope = scope
      s.value.open = true
      s.value.focusTick++
    },
    close() {
      s.value.open = false
    },
  })
}

/** Open state of the `?` shortcuts overlay. */
export const useShortcutsOverlay = () => useState('shortcuts-overlay', () => false)
