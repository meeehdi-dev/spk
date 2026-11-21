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
      slots: { header: 'text-center compact:p-3 compact:sm:px-4', body: 'compact:p-3 compact:sm:p-4', footer: 'compact:p-3 compact:sm:px-4' },
      variants: {
        variant: {
          outline: { root: 'divide-y-0' },
          soft: { root: 'divide-y-0' },
          subtle: { root: 'divide-y-0' },
        },
      },
    },
    modal: { slots: { header: 'compact:p-3 compact:sm:px-4', body: 'compact:p-3 compact:sm:p-4', footer: 'compact:p-3 compact:sm:px-4' } },
    slideover: { slots: { header: 'compact:p-3 compact:sm:px-4', body: 'compact:p-3 compact:sm:p-4', footer: 'compact:p-3 compact:sm:px-4' } },
  },
})
