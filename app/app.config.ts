// Floating menus, popovers and tooltips: base color, no ring and a deeper shadow (black in dark mode, where the default shadow is invisible).
const floating = 'bg-(--ui-bg-base) shadow-xl shadow-black/10 ring-0 dark:shadow-black/50'
const field = 'bg-(--ui-bg-field,var(--ui-bg-panel)) ring-0'
const focus = 'outline-none ring-0 focus-visible:ring-0 focus-visible:bg-elevated'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'amber',
      secondary: 'blue',
      success: 'green',
      info: 'blue',
      warning: 'yellow',
      error: 'red',
      neutral: 'zinc',
    },
    // Centered titles and no divider between a card's header, body and footer.
    // Compact density tightens the shared surfaces' padding; text and control sizes never change.
    card: {
      slots: {
        // Fields inside a card take the desktop sidebar color (--ui-bg-field).
        root: '[--ui-bg-field:var(--ui-bg-base)]',
        header: 'text-center compact:p-3 compact:sm:px-4',
        body: 'compact:p-3 compact:sm:p-4',
        footer: 'compact:p-3 compact:sm:px-4',
      },
      variants: {
        variant: {
          outline: { root: 'divide-y-0' },
          soft: { root: 'divide-y-0 bg-(--ui-bg-panel)' },
          subtle: { root: 'divide-y-0' },
        },
      },
    },
    // Overlays take the base (sidebar) color; modals, drawers and toasts have no ring.
    popover: { slots: { content: floating } },
    dropdownMenu: { slots: { content: floating } },
    contextMenu: { slots: { content: floating } },
    tooltip: { slots: { content: floating } },
    drawer: { slots: { content: 'bg-(--ui-bg-base) ring-0' } },
    // Nothing separates a modal's header from its body.
    modal: {
      variants: { fullscreen: { false: { content: 'ring-0' } } },
      slots: {
        content: 'divide-y-0 bg-(--ui-bg-base)',
        header: 'compact:p-3 compact:sm:px-4',
        body: 'compact:p-3 compact:sm:p-4',
        footer: 'compact:p-3 compact:sm:px-4',
      },
    },
    // The mobile sidebar and search menus are slideovers: no divider under their header.
    slideover: {
      slots: {
        content: 'divide-y-0 bg-(--ui-bg-base) sm:ring-0',
        header: 'compact:p-3 compact:sm:px-4',
        body: 'compact:p-3 compact:sm:p-4',
        footer: 'compact:p-3 compact:sm:px-4',
      },
    },
    toast: { slots: { root: 'bg-(--ui-bg-base) ring-0' } },
    // Quick switcher: no dividers, and the highlighted row takes the panel color on the base modal.
    commandPalette: {
      slots: { root: 'divide-y-0' },
      variants: {
        virtualize: { false: { viewport: 'divide-y-0' } },
        active: { true: { item: 'before:bg-(--ui-bg-panel)' }, false: { item: 'data-highlighted:not-data-disabled:before:bg-(--ui-bg-panel)' } },
      },
    },
    // Keys take the panel color without a ring, like fields on a base surface.
    kbd: { compoundVariants: [{ color: 'neutral', variant: 'outline', class: 'bg-(--ui-bg-panel) ring-0' }] },
    // Filled neutral buttons take the field color too, so they alternate with the surface they sit on.
    button: {
      compoundVariants: [
        {
          color: 'neutral',
          variant: ['soft', 'subtle'],
          class: 'bg-(--ui-bg-field,var(--ui-bg-panel)) disabled:bg-(--ui-bg-field,var(--ui-bg-panel)) aria-disabled:bg-(--ui-bg-field,var(--ui-bg-panel))',
        },
      ],
    },
    // Fields have no border and use the panel color, or --ui-bg-field (sidebar color) inside cards.
    // Focus lightens the background instead of drawing a ring.
    input: { variants: { variant: { outline: field } }, compoundVariants: [{ variant: 'outline', class: focus }] },
    inputMenu: {
      slots: { content: floating },
      variants: { variant: { outline: field } },
      compoundVariants: [{ variant: 'outline', class: focus }],
    },
    inputNumber: { variants: { variant: { outline: field } }, compoundVariants: [{ variant: 'outline', class: focus }] },
    select: {
      slots: { content: floating },
      variants: { variant: { outline: field } },
      compoundVariants: [{ variant: 'outline', class: `${focus} data-[state=open]:bg-elevated` }],
    },
    selectMenu: {
      slots: { content: floating },
      variants: { variant: { outline: field } },
      compoundVariants: [{ variant: 'outline', class: `${focus} data-[state=open]:bg-elevated` }],
    },
    textarea: { variants: { variant: { outline: field } }, compoundVariants: [{ variant: 'outline', class: focus }] },
  },
})
