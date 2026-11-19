import type { Me } from '~/composables/useMe'
import type { VoiceSettings } from '~/composables/useVoiceSettings'
import type { VoiceDiagnostics } from '~/utils/voice-diagnostics'
import type { VoiceMember, VoiceTile, VoiceVideoTrack } from '~/utils/voice-types'

import { computed, ref } from 'vue'

import { navigateTo } from '#imports'
import {
  DEFAULT_SCREEN_QUALITY,
  initialMute,
  isCameraResolution,
  toggleDeafen,
  toggleMute,
  userVolume,
  type CameraResolution,
  type SavedDevice,
  type ScreenQuality,
  type UserVolume,
} from '#shared/utils/voice'

export const SPEAKING_HOLD_MS = 500
const selfId = 'ui-me'
const me = ref<Me | null>({ id: selfId, email: 'you@example.test', role: 'admin', displayName: 'You', avatarKey: null })
const channelId = ref<string | null>(null)
const pendingChannelId = ref<string | null>(null)
const connecting = ref(false)
const connection = ref<'disconnected' | 'connected' | 'reconnecting' | 'signalReconnecting'>('disconnected')
const audioBlocked = ref(false)
const microphone = ref<'idle' | 'starting' | 'ready' | 'unavailable'>('idle')
const retryChannelId = ref<string | null>(null)
const mute = ref(initialMute())
const presence = ref<Record<string, VoiceMember>>({})
const watching = ref<string[]>([])
const theater = ref<string | null>(null)
const playing = ref<Record<string, string>>({})
const ping = ref<number | null>(null)
const pingHistory = ref<{ time: number; ping: number | null }[]>([])
const diagnostics = ref<VoiceDiagnostics | null>(null)
const camOn = ref(false)
const screenOn = ref(false)
const screenBusy = ref(false)
const volumeFor = ref<string | null>(null)
const volumes = ref<Record<string, Partial<UserVolume>>>({})
const devices = ref<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({ mics: [], speakers: [], cams: [] })
const defaultSettings = (): VoiceSettings => ({
  cameraResolution: 'auto',
  noise: 'enhanced',
  echo: true,
  agc: true,
  sensitivity: 50,
  outputVolume: 1,
  radioVolume: 0.1,
  screenAudio: true,
  screenQuality: { ...DEFAULT_SCREEN_QUALITY },
  soundboard: { on: true, volume: 0.7 },
  sounds: Object.fromEntries(
    ['join', 'leave', 'mute', 'deafen', 'camera', 'screen', 'watch'].map(k => [k, { on: true, volume: 0.5 }]),
  ) as VoiceSettings['sounds'],
})
const settings = ref(defaultSettings())

// Canvas capture is local-only and starts only when a video view attaches; no device APIs or permissions.
function syntheticVideo(userId: string, screen: boolean) {
  let stream: MediaStream | undefined
  const elements = new Set<HTMLMediaElement>()
  return {
    attach(element: HTMLMediaElement) {
      if (!stream && typeof document !== 'undefined') {
        const canvas = document.createElement('canvas')
        canvas.width = 960
        canvas.height = 540
        const ctx = canvas.getContext('2d')
        if (ctx && canvas.captureStream) {
          ctx.fillStyle = screen ? '#15283c' : '#31473e'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.fillStyle = '#dce9e5'
          ctx.font = '32px sans-serif'
          ctx.fillText(`${userId.replace('ui-', '')} · ${screen ? 'Screen share' : 'Camera'}`, 60, 90)
          if (screen) {
            ctx.fillStyle = '#27445f'
            for (let i = 0; i < 6; i++) ctx.fillRect(60, 150 + i * 48, 780 - i * 65, 24)
          } else {
            ctx.beginPath()
            ctx.arc(480, 300, 100, 0, Math.PI * 2)
            ctx.fill()
          }
          stream = canvas.captureStream(1)
        }
      }
      elements.add(element)
      element.srcObject = stream ?? null
    },
    detach(element: HTMLMediaElement) {
      elements.delete(element)
      element.srcObject = null
      if (!elements.size) {
        stream?.getTracks().forEach(track => track.stop())
        stream = undefined
      }
    },
    stop() {
      for (const element of elements) element.srcObject = null
      elements.clear()
      stream?.getTracks().forEach(track => track.stop())
      stream = undefined
    },
  } satisfies VoiceVideoTrack & { stop(): void }
}
const media = new Map<string, ReturnType<typeof syntheticVideo>>()
function video(id: string, screen: boolean) {
  const key = `${id}:${screen}`
  if (!media.has(key)) media.set(key, syntheticVideo(id, screen))
  return media.get(key)!
}
function clearMedia() {
  for (const track of media.values()) track.stop()
  media.clear()
}
const tiles = computed<VoiceTile[]>(() =>
  voiceMembers(channelId.value ?? '').map(member => {
    const local = member.userId === selfId
    const watch = local || watching.value.includes(member.userId)
    return {
      userId: member.userId,
      local,
      speaking: member.speaking,
      camLive: member.cam,
      screenLive: member.screen,
      screenQuality: member.screen ? (local ? settings.value.screenQuality : DEFAULT_SCREEN_QUALITY) : undefined,
      screenAudio: member.screen && (!local || settings.value.screenAudio),
      watching: watch,
      cam: member.cam && watch ? video(member.userId, false) : undefined,
      screen: member.screen && watch ? video(member.userId, true) : undefined,
    }
  }),
)
const member = (id: string): VoiceMember => ({
  channelId: id,
  muted: false,
  deafened: false,
  speaking: false,
  cam: false,
  screen: false,
  radioListening: false,
  watching: [],
})
function syncState() {
  if (!channelId.value) return
  const previous = presence.value[selfId] ?? member(channelId.value)
  presence.value = {
    ...presence.value,
    [selfId]: {
      ...previous,
      channelId: channelId.value,
      muted: mute.value.muted || microphone.value !== 'ready',
      deafened: mute.value.deafened,
      cam: camOn.value,
      screen: screenOn.value,
      watching: [...watching.value],
    },
  }
}

export function resetVoiceScenario(preset: string) {
  clearMedia()
  settings.value = defaultSettings()
  mute.value = initialMute()
  volumes.value = {}
  volumeFor.value = null
  playing.value = {}
  pendingChannelId.value = retryChannelId.value = theater.value = null
  connecting.value = preset === 'connecting'
  pendingChannelId.value = connecting.value ? 'ui-voice' : null
  screenBusy.value = false
  camOn.value = screenOn.value = false
  watching.value = []
  audioBlocked.value = preset === 'errors'
  const empty = preset === 'empty'
  channelId.value = empty || connecting.value ? null : 'ui-voice'
  connection.value = empty || connecting.value ? 'disconnected' : preset === 'reconnecting' ? 'reconnecting' : 'connected'
  microphone.value = empty || connecting.value ? 'idle' : preset === 'errors' ? 'unavailable' : 'ready'
  ping.value = empty || connecting.value || preset === 'reconnecting' ? null : 28
  pingHistory.value = ping.value === null ? [] : [{ time: Date.now(), ping: ping.value }]
  diagnostics.value = null
  presence.value = empty
    ? {}
    : {
        [selfId]: member('ui-voice'),
        'ui-alex': { ...member('ui-voice'), cam: true, screen: true, speaking: true },
        'ui-sam': { ...member('ui-voice'), cam: true, watching: ['ui-alex'] },
        'ui-jordan': { ...member('ui-voice'), muted: true },
      }
  if (!empty) watching.value = ['ui-alex']
  if (connecting.value) {
    const { [selfId]: _self, ...others } = presence.value
    presence.value = others
  }
  syncState()
}

export function setVoiceScenario(patch: {
  connection?: typeof connection.value
  audioBlocked?: boolean
  microphone?: typeof microphone.value
  speaking?: string[]
  playing?: Record<string, string>
  ping?: number | null
}) {
  if (patch.connection !== undefined) connection.value = patch.connection
  if (patch.audioBlocked !== undefined) audioBlocked.value = patch.audioBlocked
  if (patch.microphone !== undefined) microphone.value = patch.microphone
  if (patch.playing) playing.value = { ...patch.playing }
  if (patch.ping !== undefined) ping.value = patch.ping
  if (patch.speaking)
    presence.value = Object.fromEntries(Object.entries(presence.value).map(([id, m]) => [id, { ...m, speaking: patch.speaking!.includes(id) }]))
  syncState()
}

export const voiceChannelOf = (userId: string) => presence.value[userId]?.channelId ?? null
export const voiceMembers = (id: string) =>
  Object.entries(presence.value)
    .filter(([, m]) => m.channelId === id)
    .map(([userId, m]) => ({ userId, ...m }))
export function voiceDisplayMembers(id: string, self?: string) {
  const members = voiceMembers(id).map(m => ({ ...m, pending: false }))
  if (pendingChannelId.value !== id || !self) return members
  const pending = { userId: self, ...member(id), pending: true }
  const index = members.findIndex(m => m.userId === self)
  if (index === -1) members.push(pending)
  else members[index] = pending
  return members
}
export const watchersOf = (id: string) =>
  Object.entries(presence.value)
    .filter(([other, m]) => other !== id && m.channelId === voiceChannelOf(id) && m.watching.includes(id))
    .map(([other]) => other)

async function leave(_sound = true, _reason?: string) {
  clearMedia()
  const { [selfId]: _self, ...others } = presence.value
  presence.value = others
  channelId.value = pendingChannelId.value = retryChannelId.value = theater.value = null
  connection.value = 'disconnected'
  connecting.value = audioBlocked.value = camOn.value = screenOn.value = screenBusy.value = false
  microphone.value = 'idle'
  watching.value = []
  ping.value = null
  pingHistory.value = []
  diagnostics.value = null
}
async function join(id: string) {
  if (channelId.value === id || connecting.value) return
  await leave(false)
  channelId.value = id
  connection.value = 'connected'
  microphone.value = 'ready'
  ping.value = 28
  presence.value = { [selfId]: member(id), ...presence.value }
  syncState()
}
async function reconnect() {
  const id = channelId.value ?? retryChannelId.value
  if (!id) return
  await leave(false)
  await join(id)
}
function watch(id: string, on: boolean) {
  watching.value = on ? [...new Set([...watching.value, id])] : watching.value.filter(x => x !== id)
  if (on) theater.value = id
  else if (theater.value === id) theater.value = null
  syncState()
}
function setVolume(id: string, patch: Partial<UserVolume>) {
  volumes.value = { ...volumes.value, [id]: { ...volumes.value[id], ...patch } }
}
async function startScreen() {
  if (!channelId.value || screenBusy.value || screenOn.value) return
  screenOn.value = true
  syncState()
}
async function stopScreen() {
  screenOn.value = false
  if (theater.value === selfId && !camOn.value) theater.value = null
  syncState()
}
const noop = () => {}
const asyncNoop = async () => {}

export function useVoice() {
  return {
    me,
    sid: 'ui-voice-session',
    channelId,
    pendingChannelId,
    connecting,
    connection,
    audioBlocked,
    lost: computed(() => connection.value === 'reconnecting'),
    health: computed(() => (connection.value === 'reconnecting' ? 'lost' : connection.value === 'connected' && !audioBlocked.value ? 'ok' : 'unstable')),
    microphone,
    retryChannelId,
    connectionLabel: computed(() => {
      if (connecting.value) return 'Connecting…'
      if (connection.value === 'reconnecting') return 'Voice reconnecting…'
      if (connection.value === 'signalReconnecting') return 'Voice signaling reconnecting…'
      if (audioBlocked.value) return 'Audio blocked or interrupted'
      if (microphone.value === 'starting') return 'Connected · Setting up microphone…'
      if (microphone.value === 'unavailable') return 'Connected · Microphone unavailable'
      return connection.value === 'connected' ? 'Connected' : 'Not connected'
    }),
    enableAudio: async () => {
      audioBlocked.value = false
    },
    enableMicrophone: async () => {
      if (channelId.value) microphone.value = 'ready'
      syncState()
    },
    reconnect,
    syncState,
    setRadioListening: (listening: boolean) => {
      const m = presence.value[selfId]
      if (m) m.radioListening = listening
    },
    mute,
    devices,
    canPickOutput: true,
    settings,
    tiles,
    watching,
    theater,
    playing,
    ping,
    pingHistory,
    diagnostics,
    watchStream: async (id: string, userId: string) => {
      await navigateTo(`/c/${id}`)
      if (channelId.value !== id) await join(id)
      watch(userId, true)
    },
    camOn,
    screenOn,
    screenBusy,
    setScreenQuality: async (quality: ScreenQuality) => {
      settings.value.screenQuality = quality
    },
    setScreenAudio: async (on: boolean) => {
      settings.value.screenAudio = on
    },
    volumeFor,
    volumes,
    toggleCamera: async () => {
      if (!channelId.value) return
      camOn.value = !camOn.value
      if (!camOn.value && !screenOn.value && theater.value === selfId) theater.value = null
      syncState()
    },
    setCameraResolution: async (resolution: CameraResolution) => {
      if (isCameraResolution(resolution)) settings.value.cameraResolution = resolution
    },
    startScreen,
    stopScreen,
    toggleScreen: () => {
      if (screenOn.value) void stopScreen()
      else void startScreen()
    },
    watch,
    setVolume,
    volumeItems: (id: string) => {
      if (!channelId.value || id === selfId || voiceChannelOf(id) !== channelId.value) return []
      const muted = userVolume(volumes.value, id).muted
      return [
        {
          label: muted ? 'Unmute for me' : 'Mute for me',
          icon: muted ? 'i-lucide-volume-2' : 'i-lucide-volume-x',
          onSelect: () => setVolume(id, { muted: !muted }),
        },
        {
          label: 'Volume…',
          icon: 'i-lucide-sliders-horizontal',
          onSelect: () => {
            volumeFor.value = id
          },
        },
      ]
    },
    join,
    reloadForUpdate: () => resetVoiceScenario('populated'),
    move: join,
    leave,
    toggleMic: () => {
      mute.value = toggleMute(mute.value)
      syncState()
    },
    toggleHeadphones: () => {
      mute.value = toggleDeafen(mute.value)
      syncState()
    },
    applySettings: asyncNoop,
    pickDevice: async (kind: 'mic' | 'speaker' | 'mediaSpeaker' | 'camera', d: SavedDevice) => {
      settings.value = { ...settings.value, [kind]: d.deviceId === 'default' ? undefined : { deviceId: d.deviceId, label: d.label } }
    },
    routeOutputs: async (_kind: 'speaker' | 'mediaSpeaker') => [],
    refreshDevices: asyncNoop,
    allowMicrophone: asyncNoop,
    cycleNoise: () => {
      settings.value.noise = ({ off: 'standard', standard: 'enhanced', enhanced: 'off' } as const)[settings.value.noise]
    },
    toggleEcho: () => {
      settings.value.echo = !settings.value.echo
    },
    toggleAgc: () => {
      settings.value.agc = !settings.value.agc
    },
    applyOutput: noop,
    activeRoom: () => undefined,
  }
}

/** No lifecycle work: the sandbox owns presence and never connects to real services. */
export function useVoiceLive() {}

resetVoiceScenario('populated')
