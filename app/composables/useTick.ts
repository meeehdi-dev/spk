/** A `Date` ref that updates every `ms` (useNow defaults to every animation frame). */
export const useTick = (ms: number) => useNow({ scheduler: cb => useIntervalFn(cb, ms) })
