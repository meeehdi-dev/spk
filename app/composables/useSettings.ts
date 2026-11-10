import type { SettingsTab } from '#shared/utils/settings'

/** Which Settings tab the modal shows; null = closed. Every entry point calls `.value = tab`. */
export const useSettingsModal = () => useState<SettingsTab | null>('settings-modal', () => null)
