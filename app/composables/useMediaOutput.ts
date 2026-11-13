import type { MaybeRefOrGetter } from 'vue'

import { matchDevice } from '#shared/utils/voice'
import { closeMediaAudio, setMediaAudioOutput } from '~/utils/media-audio'
import { routeMediaOutput } from '~/utils/media-output'

function useMediaDevice() {
  const voice = useVoice()
  return computed(() => matchDevice(voice.settings.value.mediaSpeaker, voice.devices.value.speakers).deviceId ?? '')
}

/** Follow the media output for an attachment or soundboard editor, including while it plays. */
export function useMediaOutput(element: MaybeRefOrGetter<HTMLMediaElement | null | undefined>) {
  const device = useMediaDevice()
  watch(
    [() => toValue(element), device],
    ([target, id]) => {
      if (target) void routeMediaOutput(target, id)
    },
    { immediate: true, flush: 'post' },
  )
}

/** Layout lifetime; selecting an output must not create an AudioContext until a sound needs it. */
export function useMediaAudioLive() {
  if (!import.meta.client) return
  const device = useMediaDevice()
  watch(device, setMediaAudioOutput, { immediate: true, flush: 'sync' })
  onScopeDispose(closeMediaAudio)
}
