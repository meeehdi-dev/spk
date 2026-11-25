/** Wrap `fn` so only its first call runs. */
export const once = fn => {
  let called = false
  return (...args) => {
    if (called) return
    called = true
    return fn(...args)
  }
}

/** Push-to-talk key handling: ignores other keys and auto-repeat, sends ptt-down/ptt-up once per press. */
export const pttKeys = ({ keycode, send }) => {
  let held = false
  const handle = down => e => {
    if (e.keycode !== keycode() || held === down) return
    held = down
    send(down ? 'ptt-down' : 'ptt-up')
  }
  return { down: handle(true), up: handle(false), reset: () => (held = false) }
}
