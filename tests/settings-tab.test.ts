import { describe, expect, it } from 'vitest'

import { settingsTabFromPath } from '../shared/utils/settings'

describe('settingsTabFromPath', () => {
  it('maps deep links to tabs', () => {
    expect(settingsTabFromPath('/settings', false)).toBe('profile')
    expect(settingsTabFromPath('/settings/', true)).toBe('profile')
    expect(settingsTabFromPath('/settings/voice', false)).toBe('voice')
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
