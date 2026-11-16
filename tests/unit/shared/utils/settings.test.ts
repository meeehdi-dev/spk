import { describe, expect, it } from 'vitest'

import { SETTINGS_TABS, settingsTabFromPath } from '#shared/utils/settings'

describe('SETTINGS_TABS', () => {
  it('keeps changelog last for admins and non-admins', () => {
    expect(SETTINGS_TABS.at(-1)?.id).toBe('changelog')
    expect(SETTINGS_TABS.filter(tab => !('admin' in tab)).at(-1)?.id).toBe('changelog')
  })
})

describe('settingsTabFromPath', () => {
  it('maps deep links to tabs', () => {
    expect(settingsTabFromPath('/settings', false)).toBe('profile')
    expect(settingsTabFromPath('/settings/', true)).toBe('profile')
    expect(settingsTabFromPath('/settings/voice', false)).toBe('voice')
    expect(settingsTabFromPath('/settings/changelog', false)).toBe('changelog')
    expect(settingsTabFromPath('/settings/changelog', true)).toBe('changelog')
    expect(settingsTabFromPath('/settings/users', true)).toBe('users')
  })
  it('falls back to profile for unknown or admin-only tabs for non-admins', () => {
    expect(settingsTabFromPath('/settings/users', false)).toBe('profile')
    expect(settingsTabFromPath('/settings/nope', true)).toBe('profile')
  })
  it('ignores other paths', () => {
    expect(settingsTabFromPath('/settingsx', true)).toBeNull()
    expect(settingsTabFromPath('/c/1', true)).toBeNull()
  })
})
