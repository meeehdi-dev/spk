// Pure scroll math for the chat history list.
const NEAR_TOP = 200

/** Fetch an older page when close to the top (also true when the page doesn't fill the viewport: scrollTop is 0). */
export const needsOlder = (scrollTop: number, hasMoreBefore: boolean, busy: boolean) =>
  hasMoreBefore && !busy && scrollTop < NEAR_TOP

/** Scroll position that keeps the same message in view after content was prepended. */
export const keepPosition = (prevTop: number, prevHeight: number, newHeight: number) => prevTop + (newHeight - prevHeight)

export const atBottom = (el: { scrollHeight: number, scrollTop: number, clientHeight: number }, slack = 2) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= slack

/** Pin state after a scroll event: growth under a stale position never lowers scrollTop, so only an upward move releases the pin. */
export const pinAfterScroll = (pinned: boolean, lastTop: number, el: { scrollHeight: number, scrollTop: number, clientHeight: number }) =>
  atBottom(el) || (pinned && el.scrollTop >= lastTop)
