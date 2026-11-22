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
        root: '[--ui-bg-field:var(--ui-color-neutral-50)] dark:[--ui-bg-field:var(--ui-color-neutral-900)]',
        header: 'text-center compact:p-3 compact:sm:px-4',
        body: 'compact:p-3 compact:sm:p-4',
        footer: 'compact:p-3 compact:sm:px-4',
      },
      variants: {
        variant: {
          outline: { root: 'divide-y-0' },
          soft: { root: 'divide-y-0' },
          subtle: { root: 'divide-y-0' },
        },
      },
    },
    modal: { slots: { header: 'compact:p-3 compact:sm:px-4', body: 'compact:p-3 compact:sm:p-4', footer: 'compact:p-3 compact:sm:px-4' } },
    // The mobile sidebar and search menus are slideovers: no divider under their header.
    slideover: {
      slots: { content: 'divide-y-0', header: 'compact:p-3 compact:sm:px-4', body: 'compact:p-3 compact:sm:p-4', footer: 'compact:p-3 compact:sm:px-4' },
    },
    // Toasts take the sidebar color.
    toast: { slots: { root: 'bg-neutral-50 dark:bg-neutral-900' } },
    // Fields have no border and use the panel color, or --ui-bg-field (sidebar color) inside cards.
    input: { variants: { variant: { outline: 'bg-(--ui-bg-field,var(--ui-bg-panel)) ring-0' } } },
    inputMenu: { variants: { variant: { outline: 'bg-(--ui-bg-field,var(--ui-bg-panel)) ring-0' } } },
    inputNumber: { variants: { variant: { outline: 'bg-(--ui-bg-field,var(--ui-bg-panel)) ring-0' } } },
    select: { variants: { variant: { outline: 'bg-(--ui-bg-field,var(--ui-bg-panel)) ring-0' } } },
    selectMenu: { variants: { variant: { outline: 'bg-(--ui-bg-field,var(--ui-bg-panel)) ring-0' } } },
    textarea: { variants: { variant: { outline: 'bg-(--ui-bg-field,var(--ui-bg-panel)) ring-0' } } },
  },
})
