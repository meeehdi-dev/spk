import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { readConfig, setConfigFile, writeConfig } from '../../integrations/electron/config.js'
import { isKnown, onVoice, resetVoice, setVoice, voice } from '../../integrations/electron/state.js'
import { once, pttKeys } from '../../integrations/electron/util.js'

describe('Electron voice state', () => {
  it('coerces fields with === true, drops extra keys and notifies listeners', () => {
    const seen: unknown[] = []
    const off = onVoice((state: unknown) => seen.push(state))
    setVoice({ inCall: true, muted: 'yes', deafened: 1, camOn: true, extra: true })
    expect(voice).toEqual({ inCall: true, muted: false, deafened: false, camOn: true, screenOn: false })
    expect(isKnown()).toBe(true)
    resetVoice()
    expect(isKnown()).toBe(false)
    off()
    resetVoice()
    expect(seen).toHaveLength(2)
    expect(voice.inCall).toBe(false)
    setVoice(null)
    expect(voice.inCall).toBe(false)
  })
})

describe('Electron config', () => {
  it('returns {} when missing or invalid and merges patches', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'spk-')), 'config.json')
    setConfigFile(file)
    expect(readConfig()).toEqual({})
    writeFileSync(file, '[1]')
    expect(readConfig()).toEqual({})
    writeFileSync(file, '{nope')
    expect(readConfig()).toEqual({})
    writeConfig({ server: 'https://a.example' })
    writeConfig({ ptt: true })
    expect(readConfig()).toEqual({ server: 'https://a.example', ptt: true })
  })
})

describe('Electron push-to-talk keys', () => {
  it('sends ptt-down once per press, ptt-up on release and ignores other keys', () => {
    const sent: string[] = []
    const keys = pttKeys({ keycode: () => 5, send: (cmd: string) => sent.push(cmd) })
    keys.down({ keycode: 9 })
    keys.down({ keycode: 5 })
    keys.down({ keycode: 5 })
    keys.up({ keycode: 9 })
    keys.up({ keycode: 5 })
    keys.up({ keycode: 5 })
    expect(sent).toEqual(['ptt-down', 'ptt-up'])
  })

  it('follows a changed push-to-talk key after reset', () => {
    const sent: string[] = []
    let code = 5
    const keys = pttKeys({ keycode: () => code, send: (cmd: string) => sent.push(cmd) })
    keys.down({ keycode: 5 })
    code = 7
    keys.reset()
    keys.down({ keycode: 7 })
    keys.up({ keycode: 5 })
    keys.up({ keycode: 7 })
    expect(sent).toEqual(['ptt-down', 'ptt-down', 'ptt-up'])
  })
})

describe('Electron once', () => {
  it('runs the callback only on the first call', () => {
    const fn = vi.fn()
    const guarded = once(fn)
    guarded(1)
    guarded(2)
    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith(1)
  })
})
