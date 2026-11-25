export const COMMANDS = new Set(['toggle-mic', 'toggle-deafen', 'toggle-camera', 'toggle-screen', 'leave', 'settings', 'ptt-down', 'ptt-up'])

const empty = () => ({ inCall: false, muted: false, deafened: false, camOn: false, screenOn: false })
const listeners = new Set()
let known = false

/** True once the page reported voice state, i.e. the server supports the bridge. */
export const isKnown = () => known

// Mutated in place so importers always see the current state.
export const voice = empty()

const set = (next, isKnownNow) => {
  known = isKnownNow
  Object.assign(voice, next)
  for (const fn of listeners) fn(voice)
}

/** Coerce renderer input: each known field must be exactly true, extra keys are dropped. */
export const setVoice = raw => set(Object.fromEntries(Object.keys(empty()).map(key => [key, raw?.[key] === true])), true)
export const resetVoice = () => set(empty(), false)
export const onVoice = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
