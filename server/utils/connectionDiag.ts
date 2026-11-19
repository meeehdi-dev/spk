import { createLimiter } from './limiter'

const allowDiag = createLimiter(3, 60_000)
const KINDS = ['app', 'voice', 'voiceSignal']
const CAUSE = /^[\w-]{1,40}$/
const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(0, Math.round(v)), 86_400_000) : null)

/** Logs client-reported connection outages (see socket-browser.ts). Untrusted input: only known fields, enums and clamped numbers are printed. */
export function logConnectionDiag(userId: string, events: unknown) {
  if (!Array.isArray(events) || !allowDiag(userId)) return
  for (const e of events.slice(0, 20)) {
    if (!e || typeof e !== 'object') continue
    const { kind, cause, code, wasClean, lost, hidden, online, visibleMs, outageMs, stallMs } = e as Record<string, unknown>
    if (!KINDS.includes(kind as string) || typeof cause !== 'string' || !CAUSE.test(cause)) continue
    const fields = [
      `user=${userId}`,
      `kind=${kind as string}`,
      `cause=${cause}`,
      `code=${Number.isInteger(code) ? code : '-'}`,
      `clean=${typeof wasClean === 'boolean' ? wasClean : '-'}`,
      `lost=${lost === true}`,
      `hidden=${hidden === true}`,
      `online=${online !== false}`,
      `visibleMs=${ms(visibleMs) ?? '-'}`,
      `outageMs=${ms(outageMs) ?? '-'}`,
      `stallMs=${ms(stallMs) ?? '-'}`,
    ]
    console.info(`[ws-diag] ${fields.join(' ')}`)
  }
}
