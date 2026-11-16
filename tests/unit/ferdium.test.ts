import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const webview = require('../../integrations/ferdium/spk/webview.js') as (ferdium: {
  loop: (callback: () => void) => void
  setBadge: (count: number) => void
}) => void
const recipe = require('../../integrations/ferdium/spk/index.js') as (ferdium: unknown) => unknown

afterEach(() => vi.unstubAllGlobals())

describe('Ferdium recipe', () => {
  it('loads as CommonJS and preserves the default Ferdium backend', () => {
    const Ferdium = {}
    expect(recipe(Ferdium)).toBe(Ferdium)
    expect(require('../../integrations/ferdium/spk/package.json')).toMatchObject({
      id: 'spk',
      type: 'commonjs',
      config: { serviceURL: '', hasCustomUrl: true, hasNotificationSound: true },
    })
  })

  it.each([
    ['5', 5],
    ['0', 0],
    [null, 0],
    ['', 0],
    ['invalid', 0],
    ['-1', 0],
    ['1.5', 0],
    ['Infinity', 0],
    ['9007199254740992', 0],
  ])('sets the badge for metadata %s to %i', (content, expected) => {
    const querySelector = vi.fn(() => (content === null ? null : { getAttribute: () => content }))
    vi.stubGlobal('document', { title: 'general (99) | spk', querySelector })
    const setBadge = vi.fn()
    webview({ loop: callback => callback(), setBadge })
    expect(querySelector).toHaveBeenCalledWith('meta[name="spk-unread"]')
    expect(setBadge).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('clears a previous badge when the metadata disappears after sign-out', () => {
    const querySelector = vi.fn().mockReturnValue({ getAttribute: () => '3' })
    vi.stubGlobal('document', { querySelector })
    const setBadge = vi.fn()
    const loop = vi.fn<(callback: () => void) => void>()
    webview({ loop, setBadge })
    const update = loop.mock.calls[0]![0]
    update()
    expect(setBadge).toHaveBeenLastCalledWith(3)
    querySelector.mockReturnValue(null)
    update()
    expect(setBadge).toHaveBeenLastCalledWith(0)
  })
})
