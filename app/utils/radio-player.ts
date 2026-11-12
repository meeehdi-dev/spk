export type RadioPlayback = 'idle' | 'loading' | 'playing' | 'blocked' | 'error'

/** A fresh element per attempt keeps events and promises from old streams out of current playback. */
export function createRadioPlayer(status: (value: RadioPlayback) => void) {
  let audio: HTMLAudioElement | undefined
  let volume = 1
  let muted = false
  let sink = ''
  let timeout: ReturnType<typeof setTimeout> | undefined

  function stop() {
    clearTimeout(timeout)
    timeout = undefined
    const old = audio
    audio = undefined
    if (old) {
      old.onplaying = old.onerror = old.onended = null
      old.pause()
      old.removeAttribute('src')
      old.load()
    }
    status('idle')
  }

  async function routeOutput() {
    const target = audio
    const desired = sink
    if (!target || !('setSinkId' in target)) return
    try {
      await target.setSinkId(desired)
    } catch {
      if (audio === target && desired === sink) await target.setSinkId('').catch(() => {})
    }
    // A slower, older device change can finish last. Restore the latest choice.
    if (audio === target && desired !== sink) void routeOutput()
  }

  async function start(url: string) {
    stop()
    const target = new Audio()
    audio = target
    target.volume = volume
    target.muted = muted
    target.preload = 'none'
    target.onplaying = () => {
      if (audio === target) {
        clearTimeout(timeout)
        status('playing')
      }
    }
    const fail = () => {
      if (audio !== target) return
      stop()
      status('error')
    }
    target.onerror = target.onended = fail
    timeout = setTimeout(fail, 15_000)
    status('loading')
    target.src = url
    void routeOutput()
    try {
      await target.play()
    } catch (e) {
      if (audio !== target) return
      stop()
      status((e as Error).name === 'NotAllowedError' ? 'blocked' : 'error')
    }
  }

  return {
    start,
    stop,
    output(level: number, silent: boolean, device: string) {
      volume = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))
      muted = silent
      const changed = sink !== device
      sink = device
      if (audio) {
        audio.volume = volume
        audio.muted = muted
        if (changed) void routeOutput()
      }
    },
  }
}
