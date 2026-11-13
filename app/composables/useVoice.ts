import type {
  LocalAudioTrack,
  LocalTrack,
  LocalVideoTrack,
  Participant,
  RemoteAudioTrack,
  Room,
  ScreenShareCaptureOptions,
  Track,
  TrackPublishOptions,
  VideoTrack,
} from 'livekit-client'

import type { MicProcessor } from '~/utils/voice-processor'

import { watch as watchSocket } from 'vue'

import {
  effectiveVolume,
  initialMute,
  matchDevice,
  cameraConstraints,
  isCameraResolution,
  type CameraResolution,
  SCREEN_AUDIO_CAPTURE,
  SCREEN_AUDIO_PUBLISH,
  VOICE_PUBLISH_DEFAULTS,
  sensitivityToDb,
  toggleDeafen,
  toggleMute,
  userVolume,
  type SavedDevice,
  screenShareOptions,
  screenQualityName,
  screenQualityFromName,
  type ScreenQuality,
  type UserVolume,
} from '#shared/utils/voice'

export interface VoiceMember {
  channelId: string
  muted: boolean
  deafened: boolean
  speaking: boolean
  cam: boolean
  screen: boolean
  watching: string[]
}

// One voice session per tab. `sid` tells the server (and our other tabs) which tab owns the account's session.
const sid = import.meta.client ? crypto.randomUUID() : ''
const channelId = ref<string | null>(null)
const connecting = ref(false)
const mute = ref(initialMute())
const presence = ref<Record<string, VoiceMember>>({})
const devices = ref<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({ mics: [], speakers: [], cams: [] })
const canPickOutput = import.meta.client && 'setSinkId' in HTMLMediaElement.prototype
/** One tile per person in the room. `cam` / `screen` carry a track only for your own tracks or remote ones you are watching. */
export interface VoiceTile {
  userId: string
  local: boolean
  speaking: boolean
  camLive: boolean
  screenLive: boolean
  screenQuality?: ScreenQuality
  screenAudio: boolean
  watching: boolean
  cam?: VideoTrack
  screen?: VideoTrack
}
const tiles = shallowRef<VoiceTile[]>([])
const watching = ref<string[]>([])
/** The tile shown large; shared voice state so it survives navigating away from the channel. */
const theater = ref<string | null>(null)
/** Sound icon per user while their soundboard sound plays. */
const playing = ref<Record<string, string>>({})
const playingOff = new Map<string, ReturnType<typeof setTimeout>>()
/** Round-trip time to the LiveKit server in ms, null while unknown. */
const ping = ref<number | null>(null)
let pingTimer: ReturnType<typeof setInterval> | undefined
const camOn = ref(false)
const screenOn = ref(false)
const screenBusy = ref(false)
const screenDialog = ref(false)
let screenEpoch = 0
type ScreenSession = { video: LocalVideoTrack; audio?: LocalAudioTrack; publication?: LocalVideoTrack }
let screenSession: ScreenSession | undefined
// Stop/leave must reach accepted replacement capture even while publication is pending.
let pendingScreenSession: ScreenSession | undefined
const volumeFor = ref<string | null>(null)
const volumes = import.meta.client ? useLocalStorage<Record<string, Partial<UserVolume>>>('spk:user-volumes', {}) : ref<Record<string, Partial<UserVolume>>>({})
let room: Room | undefined
let appliedCameraResolution: CameraResolution = 'auto'
// Speaking turns on at once but off only after this hold, so pauses between words don't flicker the ring.
export const SPEAKING_HOLD_MS = 500
const speakingIds = new Set<string>()
const speakingOff = new Map<string, ReturnType<typeof setTimeout>>()
let processor: MicProcessor | undefined
let pendingJoin: AbortController | undefined
let pendingJoinDone: Promise<void> | undefined
let moveEpoch = 0

const asSaved = (d: SavedDevice): SavedDevice => ({ deviceId: d.deviceId, label: d.label })

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.deviceId)
  devices.value = {
    mics: all.filter(d => d.kind === 'audioinput'),
    speakers: all.filter(d => d.kind === 'audiooutput'),
    cams: all.filter(d => d.kind === 'videoinput'),
  }
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
    deviceId,
    echoCancellation: settings.value.echo,
    autoGainControl: settings.value.agc,
    noiseSuppression: settings.value.noise === 'standard',
    channelCount: 1,
  })

  async function allowMicrophone() {
    await refreshDevices()
    if (devices.value.mics.some(d => d.label)) return
    const deviceId = settings.value.mic?.deviceId
    const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId } : true })
    stream.getTracks().forEach(t => t.stop())
    await refreshDevices()
  }

  // The state the server shows to others: sent on change, at most every ~50 ms (the latest values go out).
  let speaking = false,
    lastSent = 0
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
    socket.send({
      type: 'voice:state',
      sid,
      muted: mute.value.muted,
      deafened: mute.value.deafened,
      speaking: speaking && !mute.value.muted,
      cam: camOn.value,
      screen: screenOn.value,
      watching: watching.value,
    })
  }

  const outputKind = (source: Track.Source): 'speaker' | 'screenSpeaker' => (source === 'screen_share_audio' ? 'screenSpeaker' : 'speaker')
  async function routeOutput(track: RemoteAudioTrack, kind = outputKind(track.source)) {
    if (!canPickOutput) return
    try {
      await track.setSinkId(matchDevice(settings.value[kind], devices.value.speakers).deviceId ?? '')
    } catch (e) {
      toast.add({ title: 'Could not switch device', description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }

  function applyOutput() {
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      const vol = userVolume(volumes.value, p.identity)
      for (const pub of p.audioTrackPublications.values()) {
        ;(pub.track as RemoteAudioTrack | undefined)?.setVolume(
          effectiveVolume(mute.value.deafened, vol, pub.source === ('screen_share_audio' as Track.Source) ? 'screen' : 'mic', settings.value.outputVolume),
        )
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
      theater.value = null
      return
    }
    const stillThere = watching.value.filter(id => room!.remoteParticipants.has(id))
    const watchingChanged = stillThere.length !== watching.value.length
    watching.value = stillThere
    if (theater.value && theater.value !== room.localParticipant.identity && !room.remoteParticipants.has(theater.value)) theater.value = null
    syncSubs()
    const make = (p: Participant): VoiceTile => {
      const cam = p.getTrackPublication('camera' as Track.Source),
        scr = p.getTrackPublication('screen_share' as Track.Source),
        audio = p.getTrackPublication('screen_share_audio' as Track.Source)
      const camLive = !!cam && !cam.isMuted,
        local = p.isLocal,
        w = local || watching.value.includes(p.identity)
      return {
        userId: p.identity,
        local,
        speaking: speakingIds.has(p.identity),
        camLive,
        screenLive: !!scr || (local && !!screenSession),
        screenQuality: screenQualityFromName(scr?.trackName),
        screenAudio: !!audio && !audio.isMuted,
        watching: w,
        cam: camLive && w ? (cam!.track as VideoTrack | undefined) : undefined,
        screen: scr && w ? (scr.track as VideoTrack | undefined) : undefined,
      }
    }
    const all = [room.localParticipant, ...room.remoteParticipants.values()]
    tiles.value = all.map(make)
    const [cam, screen] = [tiles.value[0]!.camLive, tiles.value[0]!.screenLive]
    const changed = cam !== camOn.value || screen !== screenOn.value
    camOn.value = cam
    screenOn.value = screen
    if (changed || watchingChanged) pushState()
    applyOutput()
  }
  function applyMute() {
    const track = micTrack()
    void (mute.value.muted ? track?.mute() : track?.unmute())?.catch((e: unknown) => {
      if (micTrack() !== track) return
      mute.value = { ...mute.value, muted: track!.isMuted }
      pushState()
      toast.add({ title: 'Could not change microphone state', description: (e as Error).message, color: 'error', icon: 'i-lucide-mic-off' })
    })
    applyOutput()
    pushState()
  }

  async function join(id: string) {
    if (channelId.value === id || connecting.value) return
    connecting.value = true
    if (channelId.value) await leave(false)
    const attempt = new AbortController()
    pendingJoin = attempt
    let settled!: () => void
    pendingJoinDone = new Promise(resolve => {
      settled = resolve
    })
    const signal = attempt.signal
    let r: Room | undefined
    let localMic: LocalAudioTrack | undefined
    let claimed = false
    const stopSocketWatch = watchSocket(
      socket.connected,
      on => {
        if (!on) attempt.abort(new Error('Voice socket disconnected'))
      },
      { flush: 'sync' },
    )
    const cancel = () => {
      if (claimed) socket.send({ type: 'voice:leave', sid })
      localMic?.stop()
      void r?.disconnect()
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      // Permission first: it unlocks device labels, which the saved-device matching needs.
      try {
        await allowMicrophone()
      } catch {
        throw new Error('Microphone access was denied')
      }
      signal.throwIfAborted()
      const mic = matchDevice(settings.value.mic, devices.value.mics)
      const { token, url } = await $fetch<{ token: string; url: string }>('/api/voice/token', { method: 'POST', body: { channelId: id } })
      const { Room, RoomEvent, Track } = await import('livekit-client')
      signal.throwIfAborted()
      r = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: VOICE_PUBLISH_DEFAULTS,
        videoCaptureDefaults: cameraConstraints(settings.value.cameraResolution),
        audioCaptureDefaults: captureOptions(mic.deviceId),
      })
      r.on(RoomEvent.TrackSubscribed, track => {
        if (track.kind !== Track.Kind.Audio) return
        document.body.append(track.attach()) // remote audio only plays while attached to an element
        void routeOutput(track as RemoteAudioTrack)
        applyOutput()
      })
      // Firefox: LiveKit's own default-device pick sets every remote sink on devicechange; restore ours.
      r.on(RoomEvent.ActiveDeviceChanged, kind => {
        if (kind === 'audiooutput') {
          void routeOutputs('speaker')
          void routeOutputs('screenSpeaker')
        }
      })
      r.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(e => e.remove()))
      r.on(RoomEvent.ActiveSpeakersChanged, list => {
        const active = new Set(list.map(p => p.identity))
        for (const id of active) {
          clearTimeout(speakingOff.get(id))
          speakingOff.delete(id)
          speakingIds.add(id)
        }
        for (const id of speakingIds) {
          if (active.has(id) || speakingOff.has(id)) continue
          speakingOff.set(
            id,
            setTimeout(() => {
              speakingOff.delete(id)
              speakingIds.delete(id)
              speaking = speakingIds.has(me.value?.id ?? '')
              pushState()
              rebuild()
            }, SPEAKING_HOLD_MS),
          )
        }
        speaking = speakingIds.has(me.value?.id ?? '')
        pushState()
        rebuild()
      })
      for (const ev of [
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
      ] as const)
        r.on(ev, rebuild)
      r.on(RoomEvent.Disconnected, () => {
        if (room === r) void leave(false, 'You were disconnected from voice')
        else if (pendingJoin === attempt) attempt.abort(new Error('You were disconnected from voice'))
      })
      // Replace the server session before LiveKit can evict the previous browser.
      const nonce = crypto.randomUUID()
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          clearTimeout(timeout)
          off()
          signal.removeEventListener('abort', aborted)
          if (error) reject(error)
          else resolve()
        }
        const aborted = () => finish(signal.reason)
        const off = socket.on(m => {
          if (m.type === 'voice:joined' && m.sid === sid && m.channelId === id && m.nonce === nonce) finish()
        })
        const timeout = setTimeout(() => finish(new Error('Voice join timed out')), 5000)
        signal.addEventListener('abort', aborted, { once: true })
        claimed = socket.send({ type: 'voice:join', channelId: id, sid, nonce, muted: mute.value.muted, deafened: mute.value.deafened, watching: [] })
        if (!claimed) finish(new Error('Voice socket is not connected'))
      })
      signal.throwIfAborted()
      await r.connect(url, token, { autoSubscribe: false })
      signal.throwIfAborted()
      await r.startAudio().catch(() => {})
      signal.throwIfAborted()
      const { MicProcessor } = await import('~/utils/voice-processor') // browser-only: needs AudioWorkletNode
      signal.throwIfAborted()
      const tracks = await r.localParticipant.createTracks({ audio: captureOptions(mic.deviceId) })
      localMic = tracks[0] as LocalAudioTrack
      signal.throwIfAborted()
      const nextProcessor = new MicProcessor(processing())
      try {
        await localMic.setProcessor(nextProcessor)
      } catch (e) {
        await nextProcessor.destroy()
        throw e
      }
      signal.throwIfAborted()
      localMic.stopOnMute = true
      if (mute.value.muted) await localMic.mute() // release capture before publishing a remembered mute
      signal.throwIfAborted()
      await r.localParticipant.publishTrack(localMic)
      signal.throwIfAborted()
      room = r
      processor = nextProcessor
      rebuild()
      channelId.value = id
      socket.send({ type: 'voice:ready', sid }) // LiveKit is connected: show us to everyone
      lastSent = 0
      applyMute() // the mic is published first so unmuting works; a remembered mute applies now
      startPing(r)
      playVoiceSound('join')
    } catch (e) {
      if (claimed) socket.send({ type: 'voice:leave', sid })
      pendingJoin = undefined
      clearSpeaking()
      localMic?.stop() // disconnect cannot stop a track that has not been published yet
      await r?.disconnect()
      if (!signal.aborted || signal.reason?.name !== 'AbortError') {
        toast.add({
          title: 'Could not join voice',
          description: ((signal.aborted ? signal.reason : e) as Error).message,
          color: 'error',
          icon: 'i-lucide-circle-alert',
        })
      }
    } finally {
      stopSocketWatch()
      signal.removeEventListener('abort', cancel)
      pendingJoin = undefined
      pendingJoinDone = undefined
      connecting.value = false
      settled()
    }
  }

  function startPing(r: Room) {
    stopPing()
    const read = () => {
      // shortcut: `engine.client.rtt` is LiveKit-internal; switch to a public API when one exists.
      const rtt = (r as unknown as { engine?: { client?: { rtt?: number } } }).engine?.client?.rtt
      ping.value = rtt ? Math.round(rtt) : null
    }
    read()
    pingTimer = setInterval(read, 2000)
  }
  function stopPing() {
    clearInterval(pingTimer)
    pingTimer = undefined
    ping.value = null
  }

  function clearSpeaking() {
    speakingOff.forEach(clearTimeout)
    speakingOff.clear()
    speakingIds.clear()
    speaking = false
  }

  async function move(id: string) {
    const epoch = ++moveEpoch
    if (pendingJoin) {
      const done = pendingJoinDone
      pendingJoin.abort()
      await done
    }
    if (epoch !== moveEpoch) return
    await join(id)
  }

  async function leave(sound = true, reason?: string) {
    moveEpoch++
    const pending = pendingJoin
    pending?.abort()
    const r = room
    if (!r && !channelId.value && !pending) return
    screenEpoch++
    for (const s of [screenSession, pendingScreenSession]) {
      if (s) for (const t of screenTracks(s)) t.stop()
    }
    screenSession = pendingScreenSession = undefined
    room = undefined
    clearSpeaking()
    watching.value = []
    theater.value = null
    stopPing()
    const was = channelId.value
    channelId.value = null
    if (was) socket.send({ type: 'voice:leave', sid })
    await r?.disconnect()
    processor = undefined
    rebuild()
    if (sound) playVoiceSound('leave')
    if (reason) toast.add({ title: reason, color: 'warning', icon: 'i-lucide-phone-off' })
  }

  // Sounds are for your own mute and deafen only; the rising variant plays when you unmute / undeafen.
  const toggleMic = () => {
    mute.value = toggleMute(mute.value)
    if (channelId.value) applyMute()
    playVoiceSound('mute', !mute.value.muted)
  }
  const toggleHeadphones = () => {
    mute.value = toggleDeafen(mute.value)
    if (channelId.value) applyMute()
    playVoiceSound('deafen', !mute.value.deafened)
  }

  /** Live changes from the dropdowns and the settings page. */
  async function applySettings() {
    if (!room) return
    void processor?.update(processing())
    const track = micTrack()
    const options = captureOptions(room.getActiveDevice('audioinput'))
    if (track?.isMuted) await track.applyConstraints(options) // stores constraints for reacquisition without opening the muted input
    else await track?.restartTrack(options)
    applyOutput()
  }
  const routeOutputs = (kind: 'speaker' | 'screenSpeaker') =>
    Promise.all(
      [...(room?.remoteParticipants.values() ?? [])].flatMap(p =>
        [...p.audioTrackPublications.values()]
          .filter(pub => pub.track && outputKind(pub.source) === kind)
          .map(pub => routeOutput(pub.track as RemoteAudioTrack, kind)),
      ),
    )
  async function pickDevice(kind: 'mic' | 'speaker' | 'screenSpeaker' | 'camera', d: SavedDevice) {
    const output = kind === 'speaker' || kind === 'screenSpeaker'
    const system = d.deviceId === 'default'
    settings.value = { ...settings.value, [kind]: system ? undefined : asSaved(d) }
    try {
      if (output) {
        await routeOutputs(kind)
      } else if (kind === 'mic') await room?.switchActiveDevice('audioinput', d.deviceId, !system) // non-exact: Firefox has no device with id 'default'
      else if (camOn.value) await room?.switchActiveDevice('videoinput', d.deviceId, !system)
    } catch (e) {
      toast.add({ title: 'Could not switch device', description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }
  const fail = (title: string) => (e: unknown) => toast.add({ title, description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
  const cameraOptions = () => ({
    ...cameraConstraints(settings.value.cameraResolution),
    deviceId: matchDevice(settings.value.camera, devices.value.cams).deviceId,
  })
  async function setCameraResolution(resolution: CameraResolution) {
    if (!isCameraResolution(resolution)) return
    settings.value.cameraResolution = resolution
    const track = room?.localParticipant.getTrackPublication('camera' as Track.Source)?.videoTrack
    if (!track || !camOn.value) return
    try {
      await track.restartTrack(cameraOptions())
      appliedCameraResolution = resolution
      rebuild()
    } catch (e) {
      fail('Could not change camera resolution')(e)
    }
  }
  async function toggleCamera() {
    if (!room) return
    const on = !camOn.value
    const existing = room.localParticipant.getTrackPublication('camera' as Track.Source)?.videoTrack
    const resolution = settings.value.cameraResolution
    try {
      const publication = await room.localParticipant.setCameraEnabled(on, on ? cameraOptions() : undefined)
      // LiveKit ignores capture options when unmuting an existing publication.
      if (on && existing && appliedCameraResolution !== resolution) await publication?.videoTrack?.restartTrack(cameraOptions())
      if (on) appliedCameraResolution = resolution
    } catch (e) {
      fail('Could not change camera state')(e)
    }
    rebuild()
  }
  const screenConstraints = (quality: ScreenQuality): MediaTrackConstraints => {
    const { width, height, frameRate } = screenShareOptions(quality).resolution
    return { width: { max: width }, height: { max: height }, frameRate: { ideal: frameRate, max: frameRate } }
  }
  const screenCapture = (quality: ScreenQuality, audio: boolean): ScreenShareCaptureOptions => ({
    audio: audio ? SCREEN_AUDIO_CAPTURE : false,
    resolution: { width: 0, height: 0 },
    contentHint: screenShareOptions(quality).contentHint,
    // `max` never upscales the surface; LiveKit's type only declares displaySurface.
    video: { displaySurface: 'monitor', ...screenConstraints(quality) } as { displaySurface: 'monitor' },
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
    surfaceSwitching: 'include',
  })
  const screenPublish = (quality: ScreenQuality): TrackPublishOptions => {
    const p = screenShareOptions(quality)
    return {
      ...SCREEN_AUDIO_PUBLISH,
      name: screenQualityName(quality),
      simulcast: false,
      videoCodec: p.codec,
      backupCodec: { codec: 'vp8' },
      degradationPreference: p.degradationPreference,
      screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.resolution.frameRate },
    }
  }
  const screenTracks = (s: NonNullable<typeof screenSession>): LocalTrack[] => [
    s.video,
    ...(s.publication ? [s.publication] : []),
    ...(s.audio ? [s.audio] : []),
  ]
  async function discardScreen(r: Room, tracks: LocalTrack[]) {
    // Stop capture even if unpublishing fails (or the room has already disconnected).
    for (const t of tracks) t.stop()
    await Promise.all(tracks.map(t => r.localParticipant.unpublishTrack(t).catch(fail('Could not stop screen track'))))
  }
  function capturedScreen(video: LocalVideoTrack, audio?: LocalAudioTrack): NonNullable<typeof screenSession> {
    const s = { video, audio }
    video.mediaStreamTrack.addEventListener(
      'ended',
      () => {
        if (screenSession === s) void stopScreen()
      },
      { once: true },
    )
    return s
  }
  async function unpublishScreenVideo(r: Room, s: NonNullable<typeof screenSession>) {
    if (!s.publication) return
    // Stop primary AND backup clones before unpublish forgets them; the source stays owned.
    s.publication.stop()
    await r.localParticipant.unpublishTrack(s.publication)
    s.publication = undefined
  }
  async function publishScreenVideo(r: Room, s: NonNullable<typeof screenSession>, quality: ScreenQuality) {
    const { LocalVideoTrack } = await import('livekit-client')
    if (s.video.mediaStreamTrack.readyState !== 'live') throw new Error('The screen capture stopped before it could be shared.')
    const video = new LocalVideoTrack(s.video.mediaStreamTrack.clone())
    video.source = s.video.source
    s.publication = video
    await r.localParticipant.publishTrack(video, screenPublish(quality))
    // LiveKit can override the hint while configuring VP9; keep the selected preset.
    video.mediaStreamTrack.contentHint = s.video.mediaStreamTrack.contentHint = screenShareOptions(quality).contentHint
  }
  /** Must run directly from a click: no await before createScreenTracks opens the picker. */
  async function startScreen() {
    if (!room || screenBusy.value || screenSession) return
    const r = room,
      epoch = ++screenEpoch,
      quality = settings.value.screenQuality
    const current = () => room === r && screenEpoch === epoch
    let tracks: LocalTrack[] = []
    let captured: ScreenSession | undefined
    screenBusy.value = true
    try {
      tracks = await r.localParticipant.createScreenTracks(screenCapture(quality, settings.value.screenAudio))
      if (!current()) return
      const video = tracks.find(t => t.kind === 'video') as LocalVideoTrack
      const audio = tracks.find(t => t.kind === 'audio') as LocalAudioTrack | undefined
      captured = capturedScreen(video, audio)
      screenSession = captured
      await publishScreenVideo(r, captured, quality)
      if (!current()) return
      if (audio) await r.localParticipant.publishTrack(audio, SCREEN_AUDIO_PUBLISH)
    } catch (e) {
      if (current()) {
        screenSession = undefined
        await discardScreen(r, captured ? screenTracks(captured) : tracks)
        if ((e as Error).name !== 'NotAllowedError') fail('Could not share your screen')(e)
      }
    } finally {
      if (!current()) await discardScreen(r, captured ? screenTracks(captured) : tracks)
      screenBusy.value = false
      rebuild()
    }
  }
  async function stopScreen() {
    screenEpoch++
    const r = room,
      tracks = [screenSession, pendingScreenSession].flatMap(s => (s ? screenTracks(s) : []))
    screenSession = pendingScreenSession = undefined
    rebuild()
    if (r) await discardScreen(r, tracks)
  }
  async function setScreenQuality(quality: ScreenQuality) {
    if (screenBusy.value) return
    if (!room || !screenSession) {
      settings.value.screenQuality = quality
      return
    }
    const r = room,
      s = screenSession,
      epoch = screenEpoch,
      previous = settings.value.screenQuality
    const current = () => room === r && screenEpoch === epoch && screenSession === s
    const apply = async (q: ScreenQuality) => {
      await s.video.mediaStreamTrack.applyConstraints(screenConstraints(q))
      if (!current()) return
      await unpublishScreenVideo(r, s)
      if (!current()) return
      await publishScreenVideo(r, s, q)
    }
    screenBusy.value = true
    try {
      await apply(quality)
      if (current()) settings.value.screenQuality = quality
    } catch (e) {
      if (current()) {
        fail('Could not change screen quality')(e)
        try {
          await apply(previous)
        } catch (restoreError) {
          if (current()) {
            fail('Could not restore screen sharing')(restoreError)
            await stopScreen()
          }
        }
      }
    } finally {
      if (!current()) await discardScreen(r, screenTracks(s))
      screenBusy.value = false
      rebuild()
    }
  }
  async function setScreenAudio(on: boolean) {
    if (screenBusy.value) return
    if (!room || !screenSession) {
      settings.value.screenAudio = on
      return
    }
    const r = room,
      s = screenSession,
      epoch = screenEpoch
    const current = () => room === r && screenEpoch === epoch && screenSession === s
    const usableAudio = s.audio?.mediaStreamTrack.readyState === 'live' ? s.audio : undefined
    let tracks: LocalTrack[] = [],
      replaced = false
    let replacement: NonNullable<typeof screenSession> | undefined
    screenBusy.value = true
    try {
      if (!on || usableAudio) {
        await (on ? usableAudio?.unmute() : s.audio?.mute())
        if (current()) settings.value.screenAudio = on && !!usableAudio
        return
      }
      // Capture raw screen audio, never mic processing. Keep the old share until permission succeeds.
      tracks = await r.localParticipant.createScreenTracks(screenCapture(settings.value.screenQuality, true))
      if (!current()) return
      const video = tracks.find(t => t.kind === 'video') as LocalVideoTrack
      const audio = tracks.find(t => t.kind === 'audio') as LocalAudioTrack | undefined
      if (!audio) throw new Error('This browser or selected source did not provide audio. Choose an audio-capable source and enable audio in the picker.')
      replacement = pendingScreenSession = capturedScreen(video, audio)
      const requireLive = () => {
        if (video.mediaStreamTrack.readyState !== 'live' || audio.mediaStreamTrack.readyState !== 'live')
          throw new Error('The replacement screen capture stopped before it could be shared.')
      }
      requireLive()
      replaced = true
      await unpublishScreenVideo(r, s)
      if (!current()) return
      requireLive()
      if (s.audio) {
        await r.localParticipant.unpublishTrack(s.audio, false)
        if (!current()) return
        requireLive()
      }
      await publishScreenVideo(r, replacement, settings.value.screenQuality)
      if (!current()) return
      requireLive()
      await r.localParticipant.publishTrack(audio, SCREEN_AUDIO_PUBLISH)
      if (!current()) return
      requireLive()
      screenSession = replacement
      pendingScreenSession = undefined
      settings.value.screenAudio = true
      for (const t of screenTracks(s)) t.stop()
      tracks = [] // owned by the new session now
    } catch (e) {
      if (current()) {
        fail('Could not change screen audio')(e)
        if (replaced) {
          await discardScreen(r, replacement ? screenTracks(replacement) : tracks)
          if (pendingScreenSession === replacement) pendingScreenSession = undefined
          replacement = undefined
          tracks = []
          if (!current()) return
          try {
            await publishScreenVideo(r, s, settings.value.screenQuality)
            if (current() && s.audio) await r.localParticipant.publishTrack(s.audio, SCREEN_AUDIO_PUBLISH)
          } catch (restoreError) {
            if (current()) {
              fail('Could not restore screen sharing')(restoreError)
              await stopScreen()
            }
          }
        }
        if (current()) settings.value.screenAudio = !!s.audio && !s.audio.isMuted && s.audio.mediaStreamTrack.readyState === 'live'
      }
    } finally {
      await discardScreen(r, tracks.length && replacement ? screenTracks(replacement) : tracks)
      if (pendingScreenSession === replacement) pendingScreenSession = undefined
      if (screenEpoch !== epoch || room !== r) await discardScreen(r, screenTracks(s))
      screenBusy.value = false
      rebuild()
    }
  }
  const toggleScreen = () => {
    if (!channelId.value) return
    if (screenOn.value || screenBusy.value) void stopScreen()
    else screenDialog.value = true
  }
  const watch = (id: string, on: boolean) => {
    watching.value = on ? [...new Set([...watching.value, id])] : watching.value.filter(x => x !== id)
    if (on) theater.value = id
    rebuild()
    pushState()
  }
  /** Opens the channel, joins it if needed, and puts that person's stream in theater mode. */
  async function watchStream(id: string, userId: string) {
    await navigateTo(`/c/${id}`)
    if (channelId.value !== id) await join(id)
    if (channelId.value === id) watch(userId, true)
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
    me,
    sid,
    channelId,
    connecting,
    mute,
    devices,
    canPickOutput,
    settings,
    tiles: computed(() => {
      const remote = new Map(tiles.value.filter(t => !t.local).map(t => [t.userId, t]))
      return [...tiles.value.filter(t => t.local), ...Object.keys(presence.value).flatMap(id => (remote.has(id) ? [remote.get(id)!] : []))]
    }),
    watching,
    theater,
    playing,
    ping,
    watchStream,
    camOn,
    screenOn,
    screenBusy,
    screenDialog,
    setScreenQuality,
    setScreenAudio,
    volumeFor,
    volumes,
    toggleCamera,
    setCameraResolution,
    startScreen,
    stopScreen,
    toggleScreen,
    watch,
    setVolume,
    volumeItems,
    join,
    move,
    leave,
    toggleMic,
    toggleHeadphones,
    applySettings,
    pickDevice,
    routeOutputs,
    refreshDevices,
    allowMicrophone,
    cycleNoise,
    toggleEcho,
    toggleAgc,
    applyOutput,
    activeRoom: () => room,
  }
}

/** Who in the same voice channel is watching this user's stream. */
export const watchersOf = (userId: string) => {
  const ch = presence.value[userId]?.channelId
  return Object.entries(presence.value)
    .filter(([id, m]) => id !== userId && m.channelId === ch && m.watching.includes(userId))
    .map(([id]) => id)
}

/** Shows a sound's icon for its duration (2–10 s), whatever your own audio settings. */
function showSound(userId: string, icon: string, durationMs: number) {
  clearTimeout(playingOff.get(userId))
  playing.value = { ...playing.value, [userId]: icon }
  playingOff.set(
    userId,
    setTimeout(
      () => {
        playingOff.delete(userId)
        const { [userId]: _gone, ...rest } = playing.value
        playing.value = rest
      },
      Math.min(10_000, Math.max(2000, durationMs)),
    ),
  )
}

/** The voice channel a user is in right now (null = not in voice). */
export const voiceChannelOf = (userId: string) => presence.value[userId]?.channelId ?? null

/** Users in a voice channel, from the server's presence. */
export const voiceMembers = (id: string) =>
  Object.entries(presence.value)
    .filter(([, m]) => m.channelId === id)
    .map(([userId, m]) => ({ userId, ...m }))

/** Layout only: keeps the presence map live, handles being kicked by another tab, plays others' join/leave sounds, warns before unload, keeps the screen awake in a call, follows device changes. */
export function useVoiceLive() {
  if (!import.meta.client) return
  const v = useVoice()
  const socket = useSocket()
  const { data: sounds } = useSounds()
  const load = () =>
    $fetch<Array<{ userId: string } & VoiceMember>>('/api/voice')
      .then(r => {
        presence.value = Object.fromEntries(r.map(({ userId, ...m }) => [userId, m]))
      })
      .catch(() => {})
  onMounted(load)
  socket.onOpen(() => {
    void load()
    // The server drops our session when the socket closes; take it back after a reconnect.
    if (v.channelId.value)
      socket.send({
        type: 'voice:join',
        channelId: v.channelId.value,
        sid,
        muted: v.mute.value.muted,
        deafened: v.mute.value.deafened,
        watching: v.watching.value,
        ready: true, // already connected: don't blink
      })
  })
  socket.on(m => {
    if (m.type === 'voice:presence') {
      const prev = presence.value[m.userId]
      const next = { ...presence.value }
      if (m.channelId)
        next[m.userId] = {
          channelId: m.channelId,
          muted: m.muted,
          deafened: m.deafened,
          speaking: m.speaking,
          cam: !!m.cam,
          screen: !!m.screen,
          watching: m.watching ?? [],
        }
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
        // Someone else starts or stops watching your screen share.
        const myId = v.me.value?.id
        if (myId && m.userId !== myId && v.screenOn.value) {
          const was = prev.watching.includes(myId),
            now = !!m.watching?.includes(myId)
          if (was !== now) playVoiceSound('watch', now)
        }
      }
    } else if (m.type === 'voice:sound') {
      const sound = sounds.value.find(x => x.id === m.soundId)
      if (sound) showSound(m.userId, `i-lucide-${sound.icon}`, sound.durationMs)
      if (v.channelId.value && !v.mute.value.deafened) void playSound(m.soundId)
    } else if (m.type === 'voice:disconnect' && m.sid === sid && (v.channelId.value || v.connecting.value)) {
      void v.leave(false, m.reason)
    } else if (m.type === 'voice:move' && m.sid === sid && (v.channelId.value || v.connecting.value)) {
      // Settle a pending connection before joining the admin's destination.
      void v.move(m.channelId).then(() => {
        if (v.channelId.value === m.channelId) {
          useToast().add({ title: 'An admin moved you to another voice channel', color: 'warning', icon: 'i-lucide-move-right' })
          void navigateTo(`/c/${m.channelId}`)
        }
      })
    } else if (m.type === 'voice:kicked' && m.sid !== sid && (v.channelId.value || v.connecting.value)) {
      void v.leave(false, 'You joined voice from another tab or device')
    }
  })
  useEventListener(window, 'beforeunload', e => {
    if (v.channelId.value) e.preventDefault()
  })
  // Keep the machine awake during a call; the browser drops the lock while the tab is hidden.
  const wakeLock = useWakeLock()
  watch(
    () => !!v.channelId.value,
    on => (on ? wakeLock.request('screen') : wakeLock.release()).catch(() => {}),
  )
  useEventListener(navigator.mediaDevices, 'devicechange', async () => {
    const outputs = (['speaker', 'screenSpeaker'] as const).map(kind => ({
      kind,
      active: matchDevice(v.settings.value[kind], devices.value.speakers).deviceId,
    }))
    const micBefore = matchDevice(v.settings.value.mic, devices.value.mics).deviceId
    const defaultLabel = devices.value.mics.find(d => d.deviceId === 'default')?.label
    await v.refreshDevices()
    const r = v.activeRoom()
    if (!r) return
    const active = r.getActiveDevice('audioinput')
    const savedMic = v.settings.value.mic?.deviceId === 'default' ? undefined : v.settings.value.mic // Chromium's 'default' entry means follow the OS
    const micNow = matchDevice(savedMic, devices.value.mics).deviceId
    const unplugged = () =>
      useToast().add({ title: 'Your microphone was unplugged', description: 'Switched to the default device.', icon: 'i-lucide-headphones', color: 'warning' })
    if (savedMic && micBefore && !micNow) {
      await r.switchActiveDevice('audioinput', 'default', false).catch(() => {}) // non-exact: Firefox has no device with id 'default'
      unplugged()
    } else if (savedMic && !micBefore && micNow && active !== micNow) {
      await r
        .switchActiveDevice('audioinput', micNow)
        .then(() =>
          useToast().add({ title: `Switched back to ${savedMic.label}`, description: 'Your microphone is back.', icon: 'i-lucide-headphones', color: 'info' }),
        )
        .catch((e: Error) => useToast().add({ title: 'Could not switch device', description: e.message, color: 'error', icon: 'i-lucide-circle-alert' }))
    } else if (!savedMic && active && active !== 'default' && !devices.value.mics.some(d => d.deviceId === active)) {
      unplugged() // LiveKit recovers the track itself
    } else if (!savedMic && active === 'default' && defaultLabel && defaultLabel !== devices.value.mics.find(d => d.deviceId === 'default')?.label) {
      await v.applySettings().catch(() => {}) // Chromium keeps the old physical device when the OS default changes
    }
    if (v.canPickOutput)
      for (const { kind, active } of outputs) {
        const saved = v.settings.value[kind]
        if (!saved) continue
        const now = matchDevice(saved, devices.value.speakers).deviceId
        if (!!active === !!now) continue
        await v.routeOutputs(kind)
        const name = kind === 'speaker' ? 'voice output' : 'screen-share output'
        useToast().add(
          now
            ? { title: `Switched back to ${saved.label}`, description: `Your ${name} is back.`, icon: 'i-lucide-headphones', color: 'info' }
            : { title: `Your ${name} was unplugged`, description: 'Switched to the default device.', icon: 'i-lucide-headphones', color: 'warning' },
        )
      }
  })
  onMounted(() => v.refreshDevices())
}
