import { SETTINGS_TABS } from '#shared/utils/settings'

declare global {
  interface Window {
    /** Exposed by the Electron desktop shell's preload; absent in browsers. */
    spkDesktop?: {
      setServer?: (url: string) => Promise<unknown>
      voiceState?: (state: { inCall: boolean; muted: boolean; deafened: boolean; camOn: boolean; screenOn: boolean }) => void
      onCommand?: (cb: (cmd: string) => void) => () => void
      attention?: () => void
      focus?: () => void
      screenAudioFailed?: () => void
    }
  }
}

// Mirrors voice state to the desktop shell and runs its menu, tray and shortcut commands.
export default defineNuxtPlugin(() => {
  const desktop = window.spkDesktop
  if (!desktop?.voiceState) return
  const voice = useVoice()
  const settingsTab = useSettingsModal()

  watch(
    () => ({
      inCall: !!voice.channelId.value,
      muted: voice.mute.value.muted,
      deafened: voice.mute.value.deafened,
      camOn: voice.camOn.value,
      screenOn: voice.screenOn.value,
    }),
    state => desktop.voiceState?.(state),
    { immediate: true, deep: true },
  )

  const commands: Record<string, () => unknown> = {
    'toggle-mic': voice.toggleMic,
    'toggle-deafen': voice.toggleHeadphones,
    'toggle-camera': voice.toggleCamera,
    'toggle-screen': voice.toggleScreen,
    leave: () => voice.leave(),
    settings: () => (settingsTab.value = SETTINGS_TABS[0].id),
    'ptt-down': () => voice.holdToTalk(true),
    'ptt-up': () => voice.holdToTalk(false),
  }
  desktop.onCommand?.(cmd => void commands[cmd]?.())
})
