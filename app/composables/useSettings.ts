import type { SettingsTab } from '#shared/utils/settings'

/** Which Settings tab the modal shows; null = closed. Every entry point calls `.value = tab`. */
export const useSettingsModal = () => useState<SettingsTab | null>('settings-modal', () => null)

/** Show GIFs as a still frame until hovered or focused. */
export const useGifOnHover = () => useLocalStorage('spk:gif-on-hover', false)
