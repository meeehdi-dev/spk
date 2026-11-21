import { afterEach, expect, it, vi } from 'vitest'

import { logConnectionDiag } from '~~/server/utils/connectionDiag'

afterEach(() => vi.restoreAllMocks())

it('logs known fields only and drops malformed or forged events', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  logConnectionDiag('u1', [
    {
      kind: 'app',
      cause: 'close',
      code: 1006,
      wasClean: false,
      lost: true,
      hidden: true,
      online: true,
      visibleMs: null,
      outageMs: 7200.4,
      stallMs: 1e12,
      extra: 'x',
    },
    { kind: 'voice', cause: 'bad cause\n[error] forged' },
    { kind: 'other', cause: 'close' },
    null,
  ])
  expect(info.mock.calls).toEqual([
    ['[ws-diag] user=u1 kind=app cause=close code=1006 clean=false lost=true hidden=true online=true visibleMs=- outageMs=7200 stallMs=86400000'],
  ])
})

it('logs a valid voice track sid and drops forged ones', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  logConnectionDiag('u4', [
    { kind: 'voiceTrack', cause: 'resubscribed', track: 'TR_AMdM34EpsyrDWf' },
    { kind: 'voiceTrack', cause: 'subFailed', track: 'TR_x\n[error] forged' },
  ])
  expect(info.mock.calls.map(c => c[0])).toEqual([
    '[ws-diag] user=u4 kind=voiceTrack cause=resubscribed code=- clean=- lost=false hidden=false online=true visibleMs=- outageMs=- stallMs=- track=TR_AMdM34EpsyrDWf',
    '[ws-diag] user=u4 kind=voiceTrack cause=subFailed code=- clean=- lost=false hidden=false online=true visibleMs=- outageMs=- stallMs=-',
  ])
})

it('caps events per frame and frames per user', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const events = Array.from({ length: 50 }, () => ({ kind: 'voiceSignal', cause: 'reconnected' }))
  for (let i = 0; i < 5; i++) logConnectionDiag('u2', events)
  logConnectionDiag('u3', 'not an array')
  expect(info).toHaveBeenCalledTimes(60)
})
