import type { RadioState } from '#shared/utils/radio'

import { matchDevice } from '#shared/utils/voice'
import { createRadioPlayer, type RadioPlayback } from '~/utils/radio-player'

const state = shallowRef<RadioState | null>(null)
const playback = ref<RadioPlayback>('idle')
const enabled = ref(true)
const commandError = ref('')
let player: ReturnType<typeof createRadioPlayer> | undefined

export function useRadio() {
  const voice = useVoice()
  const socket = useSocket()
  const current = computed(() => (state.value?.channelId === voice.channelId.value ? state.value : null))
  const station = computed(() => current.value?.station ?? null)
  const settings = voice.settings
  const listen = () => {
    enabled.value = true
    if (station.value && socket.connected.value) void player?.start(station.value.url)
  }
  function command(type: 'voice:radio:set' | 'voice:radio:stop', stationId?: string) {
    commandError.value = ''
    if (!socket.send({ type, sid: voice.sid, stationId })) commandError.value = 'Radio controls are offline. Wait for reconnection.'
  }
  return {
    station,
    playback,
    enabled,
    commandError,
    volume: computed({
      get: () => settings.value.radioVolume,
      set: (value: number) => {
        settings.value.radioVolume = value
      },
    }),
    select: (id: string) => command('voice:radio:set', id),
    stop: () => command('voice:radio:stop'),
    listen,
    mute: () => {
      enabled.value = false
      player?.stop()
    },
  }
}

/** Layout lifetime: page navigation and duplicate popovers must not create duplicate players. */
export function useRadioLive() {
  if (!import.meta.client) return
  const voice = useVoice()
  const socket = useSocket()
  const radio = useRadio()
  player = createRadioPlayer(value => {
    playback.value = value
  })
  const refresh = () => {
    if (voice.channelId.value && socket.connected.value) socket.send({ type: 'voice:radio:get', sid: voice.sid })
  }
  const reset = () => {
    state.value = null
    commandError.value = ''
    player?.stop()
  }
  watch(
    [voice.channelId, socket.connected],
    () => {
      reset()
    },
    { flush: 'sync' },
  )
  socket.on(m => {
    if (socket.connected.value && m.type === 'voice:radio:state' && m.sid === voice.sid && m.channelId === voice.channelId.value) {
      if (state.value && m.revision <= state.value.revision) return
      state.value = m
      commandError.value = ''
    } else if (m.type === 'voice:radio:error' && m.sid === voice.sid && (!m.channelId || m.channelId === voice.channelId.value)) {
      commandError.value = m.error
    }
  })
  watch(
    () => radio.station.value?.url,
    url => {
      if (url && enabled.value && socket.connected.value) void player?.start(url)
      else player?.stop()
    },
    { flush: 'sync' },
  )
  watch(
    () =>
      [
        voice.mute.value.deafened,
        voice.settings.value.radioVolume,
        voice.settings.value.outputVolume,
        voice.settings.value.speaker,
        voice.devices.value.speakers,
      ] as const,
    () =>
      player?.output(
        voice.settings.value.radioVolume * voice.settings.value.outputVolume,
        voice.mute.value.deafened,
        matchDevice(voice.settings.value.speaker, voice.devices.value.speakers).deviceId ?? '',
      ),
    { deep: true, immediate: true, flush: 'sync' },
  )
  onMounted(refresh)
  onScopeDispose(() => {
    reset()
    player = undefined
  })
}
