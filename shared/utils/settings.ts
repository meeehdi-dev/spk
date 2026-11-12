export const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile', icon: 'i-lucide-user' },
  { id: 'appearance', label: 'Appearance', icon: 'i-lucide-palette' },
  { id: 'voice', label: 'Voice & Video', icon: 'i-lucide-mic' },
  { id: 'notifications', label: 'Notifications', icon: 'i-lucide-bell' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'i-lucide-keyboard' },
  { id: 'soundboard', label: 'Soundboard', icon: 'i-lucide-megaphone', admin: true },
  { id: 'invites', label: 'Invites', icon: 'i-lucide-mail-plus', admin: true },
  { id: 'users', label: 'Users', icon: 'i-lucide-users', admin: true },
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

/** `/settings` and `/settings/<tab>` deep links → the tab to open (profile when unknown or admin-only for a non-admin); null for other paths. */
export function settingsTabFromPath(path: string, isAdmin: boolean): SettingsTab | null {
  const m = /^\/settings(?:\/([^/]*))?\/?$/.exec(path)
  if (!m) return null
  const t = SETTINGS_TABS.find(x => x.id === m[1])
  return t && (isAdmin || !('admin' in t)) ? t.id : 'profile'
}
