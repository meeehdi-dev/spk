import type { Participant, RemoteAudioTrack, Room, Track, VideoTrack } from 'livekit-client'

import type { MicProcessor } from '~/utils/voice-processor'

import { effectiveVolume, initialMute, matchDevice, CAMERA_CAPTURE, SCREEN_AUDIO_CAPTURE, SCREEN_AUDIO_PUBLISH, SCREEN_SHARE, VOICE_PUBLISH_DEFAULTS, sensitivityToDb, toggleDeafen, toggleMute, userVolume, type SavedDevice, type UserVolume } from '#shared/utils/voice'

export interface VoiceMember { channelId: string, muted: boolean, deafened: boolean, speaking: boolean, cam: boolean, screen: boolean }

// One voice session per tab. `sid` tells the server (and our other tabs) which tab owns the account's session.
const sid = import.meta.client ? crypto.randomUUID() : ''
const channelId = ref<string | null>(null)
const connecting = ref(false)
const mute = ref(initialMute())
const presence = ref<Record<string, VoiceMember>>({})
const devices = ref<{ mics: MediaDeviceInfo[], speakers: MediaDeviceInfo[], cams: MediaDeviceInfo[] }>({ mics: [], speakers: [], cams: [] })
const canPickOutput = import.meta.client && 'setSinkId' in HTMLMediaElement.prototype
/** One tile per person in the room. `cam` / `screen` carry a track only for your own tracks or remote ones you are watching. */
export interface VoiceTile {
  userId: string
  local: boolean
  speaking: boolean
  camLive: boolean
  screenLive: boolean
  screenAudio: boolean
  watching: boolean
  cam?: VideoTrack
  screen?: VideoTrack
}
const tiles = shallowRef<VoiceTile[]>([])
const watching = ref<string[]>([])
const camOn = ref(false)
const screenOn = ref(false)
const volumeFor = ref<string | null>(null)
const volumes = import.meta.client ? useLocalStorage<Record<string, Partial<UserVolume>>>('spk:user-volumes', {}) : ref<Record<string, Partial<UserVolume>>>({})
let room: Room | undefined
let processor: MicProcessor | undefined

const asSaved = (d: MediaDeviceInfo): SavedDevice => ({ deviceId: d.deviceId, label: d.label })

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.deviceId)
  devices.value = { mics: all.filter(d => d.kind === 'audioinput'), speakers: all.filter(d => d.kind === 'audiooutput'), cams: all.filter(d => d.kind === 'videoinput') }
}

/** Voice state and actions. Safe to call from any component (the state is shared). */
export function useVoice() {
  const settings = useVoiceSettings()
  const socket = useSocket()
  const toast = useToast()
  const { data: me } = useMe()

  const micTrack = () => room?.localParticipant.getTrackPublication('microphone' as Track.Source)?.audioTrack
  const processing = () => ({ enhanced: settings.value.noise === 'enhanced', thresholdDb: sensitivityToDb(settings.value.sensitivity) })
  const captureOptions = (deviceId?: string) => ({
    deviceId, echoCancellation: settings.value.echo, autoGainControl: settings.value.agc,
    noiseSuppression: settings.value.noise === 'standard', channelCount: 1,
  })

  // The state the server shows to others: sent on change, at most every ~50 ms (the latest values go out).
  let speaking = false, lastSent = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  function pushState() {
    if (!channelId.value) return
    const wait = 50 - (Date.now() - lastSent)
    if (wait > 0) {
      timer ??= setTimeout(() => {
        timer = undefined
        pushState()
      }, wait)
      return
    }
    lastSent = Date.now()
    socket.send({ type: 'voice:state', sid, muted: mute.value.muted, deafened: mute.value.deafened, speaking: speaking && !mute.value.muted, cam: camOn.value, screen: screenOn.value })
  }

  function applyOutput() {
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      const vol = userVolume(volumes.value, p.identity)
      for (const pub of p.audioTrackPublications.values()) {
        (pub.track as RemoteAudioTrack | undefined)?.setVolume(effectiveVolume(mute.value.deafened, vol, pub.source === ('screen_share_audio' as Track.Source) ? 'screen' : 'mic', settings.value.outputVolume))
      }
    }
  }

  // Remote video is opt-in (autoSubscribe is off): mic audio is always subscribed, everything else only while watching that person.
  function syncSubs() {
    for (const p of room?.remoteParticipants.values() ?? []) {
      for (const pub of p.trackPublications.values()) {
        const want = pub.source === ('microphone' as Track.Source) || watching.value.includes(p.identity)
        if (pub.isDesired !== want) pub.setSubscribed(want)
      }
    }
  }
  function rebuild() {
    if (!room) {
      tiles.value = []
      camOn.value = screenOn.value = false
      return
    }
    watching.value = watching.value.filter(id => room!.remoteParticipants.get(id)?.videoTrackPublications.size)
    syncSubs()
    const make = (p: Participant): VoiceTile => {
      const cam = p.getTrackPublication('camera' as Track.Source), scr = p.getTrackPublication('screen_share' as Track.Source)
      const camLive = !!cam && !cam.isMuted, local = p.isLocal, w = local || watching.value.includes(p.identity)
      return {
        userId: p.identity, local, speaking: p.isSpeaking, camLive, screenLive: !!scr, screenAudio: !!p.getTrackPublication('screen_share_audio' as Track.Source), watching: w,
        cam: camLive && w ? cam!.track as VideoTrack | undefined : undefined, screen: scr && w ? scr.track as VideoTrack | undefined : undefined,
      }
    }
    const all = [room.localParticipant, ...room.remoteParticipants.values()]
    tiles.value = all.map(make)
    const [cam, screen] = [tiles.value[0]!.camLive, tiles.value[0]!.screenLive]
    const changed = cam !== camOn.value || screen !== screenOn.value
    camOn.value = cam
    screenOn.value = screen
    if (changed) pushState()
    applyOutput()
  }
  function applyMute() {
    void (mute.value.muted ? micTrack()?.mute() : micTrack()?.unmute())
    applyOutput()
    pushState()
  }

  async function join(id: string) {
    if (channelId.value === id || connecting.value) return
    if (channelId.value) await leave(false)
    connecting.value = true
    try {
      // Permission first: it unlocks device labels, which the saved-device matching needs.
      try {
        (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop())
      } catch {
        throw new Error('Microphone access was denied')
      }
      await refreshDevices()
      const mic = matchDevice(settings.value.mic, devices.value.mics)
      const out = matchDevice(settings.value.speaker, devices.value.speakers)
      const { token, url } = await $fetch<{ token: string, url: string }>('/api/voice/token', { method: 'POST', body: { channelId: id } })
      const { Room, RoomEvent, Track } = await import('livekit-client')
      const r = new Room({ adaptiveStream: true, dynacast: true, publishDefaults: VOICE_PUBLISH_DEFAULTS, videoCaptureDefaults: CAMERA_CAPTURE, audioCaptureDefaults: captureOptions(mic.deviceId), audioOutput: canPickOutput && out.deviceId ? { deviceId: out.deviceId } : undefined })
      r.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return
        document.body.append(track.attach()) // remote audio only plays while attached to an element
        applyOutput()
      })
      r.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(e => e.remove()))
      r.on(RoomEvent.ActiveSpeakersChanged, (list) => {
        speaking = list.some(p => p.isLocal)
        pushState()
        rebuild()
      })
      for (const ev of [RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected] as const) r.on(ev, rebuild)
      r.on(RoomEvent.Disconnected, () => {
        if (room === r)
          void leave(false, 'You were disconnected from voice')
      })
      await r.connect(url, token, { autoSubscribe: false })
      room = r
      rebuild()
      await r.startAudio().catch(() => {})
      await r.localParticipant.setMicrophoneEnabled(true, captureOptions(mic.deviceId))
      const { MicProcessor } = await import('~/utils/voice-processor') // browser-only: needs AudioWorkletNode
      processor = new MicProcessor(processing())
      await micTrack()?.setProcessor(processor)
      channelId.value = id
      mute.value = initialMute()
      lastSent = 0
      socket.send({ type: 'voice:join', channelId: id, sid, muted: false, deafened: false })
      playVoiceSound('join')
    } catch (e) {
      void room?.disconnect()
      room = undefined
      processor = undefined
      toast.add({ title: 'Could not join voice', description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    } finally { connecting.value = false }
  }

  async function leave(sound = true, reason?: string) {
    const r = room
    if (!r && !channelId.value) return
    room = undefined
    watching.value = []
    const was = channelId.value
    channelId.value = null
    mute.value = initialMute()
    if (was) socket.send({ type: 'voice:leave', sid })
    await r?.disconnect()
    processor = undefined
    rebuild()
    if (sound) playVoiceSound('leave')
    if (reason) toast.add({ title: reason, color: 'warning', icon: 'i-lucide-phone-off' })
  }

  // Sounds are for your own mute and deafen only; the rising variant plays when you unmute / undeafen.
  const toggleMic = () => {
    if (!channelId.value) return
    mute.value = toggleMute(mute.value)
    applyMute()
    playVoiceSound('mute', !mute.value.muted)
  }
  const toggleHeadphones = () => {
    if (!channelId.value) return
    mute.value = toggleDeafen(mute.value)
    applyMute()
    playVoiceSound('deafen', !mute.value.deafened)
  }

  /** Live changes from the dropdowns and the settings page. */
  async function applySettings() {
    if (!room) return
    void processor?.update(processing())
    await micTrack()?.restartTrack(captureOptions(room.getActiveDevice('audioinput')))
    applyOutput()
  }
  async function pickDevice(kind: 'mic' | 'speaker' | 'camera', d: MediaDeviceInfo) {
    settings.value = { ...settings.value, [kind]: asSaved(d) }
    try {
      if (kind === 'mic') await room?.switchActiveDevice('audioinput', d.deviceId)
      else if (kind === 'speaker') await room?.switchActiveDevice('audiooutput', d.deviceId)
      else if (camOn.value) await room?.switchActiveDevice('videoinput', d.deviceId)
    } catch (e) {
      toast.add({ title: 'Could not switch device', description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }
  const fail = (title: string) => (e: unknown) => toast.add({ title, description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
  async function toggleCamera() {
    if (!room) return
    const on = !camOn.value
    await room.localParticipant.setCameraEnabled(on, on ? { deviceId: matchDevice(settings.value.camera, devices.value.cams).deviceId } : undefined).catch(fail('Could not turn the camera on'))
    rebuild()
  }
  /** Must run from a click (the browser's picker needs a user gesture): the share button or its shortcut. */
  async function startScreen() {
    if (!room) return
    const p = SCREEN_SHARE
    // Screen audio is captured raw (no browser processing) and published as its own track with no processor, whatever the mic noise setting is.
    await room.localParticipant.setScreenShareEnabled(true, {
      audio: settings.value.screenAudio ? SCREEN_AUDIO_CAPTURE : false, resolution: { width: 0, height: 0 }, contentHint: p.contentHint, // 0×0: LiveKit adds no `ideal` size
      // `max` is a ceiling, so the capture is never upscaled past the shared surface; LiveKit's type only declares displaySurface.
      video: { displaySurface: 'monitor', width: { max: p.resolution.width }, height: { max: p.resolution.height }, frameRate: { ideal: p.resolution.frameRate, max: p.resolution.frameRate } } as { displaySurface: 'monitor' }, selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'include',
    }, {
      ...SCREEN_AUDIO_PUBLISH, simulcast: false, videoCodec: p.codec, backupCodec: p.codec === 'vp9' ? { codec: 'vp8' } : false, degradationPreference: p.degradationPreference,
      screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.resolution.frameRate },
    }).catch((e: Error) => { if (e.name !== 'NotAllowedError') fail('Could not share your screen')(e) }) // NotAllowedError = picker cancelled
    rebuild()
  }
  const stopScreen = async () => {
    await room?.localParticipant.setScreenShareEnabled(false)
    rebuild()
  }
  const toggleScreen = () => {
    if (!channelId.value)
      return
    if (screenOn.value)
      void stopScreen(); else
      void startScreen()
  }
  const watch = (id: string, on: boolean) => {
    watching.value = on ? [...new Set([...watching.value, id])] : watching.value.filter(x => x !== id)
    rebuild()
  }
  const setVolume = (id: string, patch: Partial<UserVolume>) => {
    volumes.value = { ...volumes.value, [id]: { ...volumes.value[id], ...patch } }
    applyOutput()
  }
  /** Context-menu entries for a person in the channel you're in: mute for me and the volume sliders. */
  const volumeItems = (id: string) => {
    if (!channelId.value || id === me.value?.id || presence.value[id]?.channelId !== channelId.value) return []
    const muted = userVolume(volumes.value, id).muted
    return [
      { label: muted ? 'Unmute for me' : 'Mute for me', icon: muted ? 'i-lucide-volume-2' : 'i-lucide-volume-x', onSelect: () => setVolume(id, { muted: !muted }) },
      { label: 'Volume…', icon: 'i-lucide-sliders-horizontal', onSelect: () => { volumeFor.value = id } },
    ]
  }

  const cycleNoise = () => {
    settings.value.noise = ({ off: 'standard', standard: 'enhanced', enhanced: 'off' } as const)[settings.value.noise]
    void applySettings()
  }
  const toggleEcho = () => {
    settings.value.echo = !settings.value.echo
    void applySettings()
  }
  const toggleAgc = () => {
    settings.value.agc = !settings.value.agc
    void applySettings()
  }

  return {
    me, sid, channelId, connecting, mute, devices, canPickOutput, settings,
    tiles, watching, camOn, screenOn, volumeFor, volumes, toggleCamera, startScreen, stopScreen, toggleScreen, watch, setVolume, volumeItems,
    join, leave, toggleMic, toggleHeadphones, applySettings, pickDevice, refreshDevices, cycleNoise, toggleEcho, toggleAgc, applyOutput,
    activeRoom: () => room,
  }
}

/** The voice channel a user is in right now (null = not in voice). */
export const voiceChannelOf = (userId: string) => presence.value[userId]?.channelId ?? null

/** Users in a voice channel, from the server's presence. */
export const voiceMembers = (id: string) => Object.entries(presence.value).filter(([, m]) => m.channelId === id).map(([userId, m]) => ({ userId, ...m }))

/** Layout only: keeps the presence map live, handles being kicked by another tab, plays others' join/leave sounds, warns before unload, follows device changes. */
export function useVoiceLive() {
  if (!import.meta.client) return
  const v = useVoice()
  const socket = useSocket()
  const load = () => $fetch<Array<{ userId: string } & VoiceMember>>('/api/voice').then((r) => {
    presence.value = Object.fromEntries(r.map(({ userId, ...m }) => [userId, m]))
  }).catch(() => {})
  onMounted(load)
  socket.onOpen(() => {
    void load()
    // The server drops our session when the socket closes; take it back after a reconnect.
    if (v.channelId.value) socket.send({ type: 'voice:join', channelId: v.channelId.value, sid, muted: v.mute.value.muted, deafened: v.mute.value.deafened })
  })
  socket.on((m) => {
    if (m.type === 'voice:presence') {
      const prev = presence.value[m.userId]
      const next = { ...presence.value }
      if (m.channelId) next[m.userId] = { channelId: m.channelId, muted: m.muted, deafened: m.deafened, speaking: m.speaking, cam: !!m.cam, screen: !!m.screen }
      else Reflect.deleteProperty(next, m.userId)
      presence.value = next
      const mine = v.channelId.value
      if (mine && m.userId !== v.me.value?.id) {
        if (m.channelId === mine && prev?.channelId !== mine) playVoiceSound('join')
        else if (prev?.channelId === mine && m.channelId !== mine) playVoiceSound('leave')
      }
      // Your own echo counts too; a user joining with the camera already on only plays the join sound.
      if (mine && m.channelId === mine && prev?.channelId === mine) {
        for (const k of ['cam', 'screen'] as const) {
          if (!!prev[k] !== !!m[k]) playVoiceSound(k === 'cam' ? 'camera' : 'screen', !!m[k])
        }
      }
    } else if (m.type === 'voice:sound') {
      if (v.channelId.value && !v.mute.value.deafened) void playSound(m.soundId)
    } else if (m.type === 'voice:disconnect' && m.sid === sid && v.channelId.value) {
      void v.leave(false, m.reason)
    } else if (m.type === 'voice:move' && m.sid === sid && v.channelId.value) {
      // An admin moved us: switch rooms (join leaves the old one first).
      void v.join(m.channelId).then(() => {
        if (v.channelId.value === m.channelId) {
          useToast().add({ title: 'An admin moved you to another voice channel', color: 'warning', icon: 'i-lucide-move-right' })
          void navigateTo(`/c/${m.channelId}`)
        }
      })
    } else if (m.type === 'voice:kicked' && m.sid !== sid && v.channelId.value) {
      void v.leave(false, 'You joined voice from another tab or device')
    }
  })
  useEventListener(window, 'beforeunload', (e) => {
    if (v.channelId.value)
      e.preventDefault()
  })
  useEventListener(navigator.mediaDevices, 'devicechange', async () => {
    await v.refreshDevices()
    const r = v.activeRoom()
    if (!r) return
    for (const [kind, list, label] of [['audioinput', devices.value.mics, 'microphone'], ['audiooutput', devices.value.speakers, 'speakers']] as const) {
      const active = r.getActiveDevice(kind)
      if (active && active !== 'default' && !list.some(d => d.deviceId === active)) {
        await r.switchActiveDevice(kind, 'default').catch(() => {})
        useToast().add({ title: `Your ${label} was unplugged`, description: 'Switched to the default device.', icon: 'i-lucide-headphones', color: 'warning' })
      }
    }
  })
  onMounted(() => v.refreshDevices())
}
