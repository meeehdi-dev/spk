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
import type { VoiceMember, VoiceTile } from '~/utils/voice-types'

import { computed, onMounted, ref, shallowRef, watch, watch as watchSocket } from 'vue'

import {
  useEventListener,
  useLocalStorage,
  useMe,
  useSocket,
  useSounds,
  useToast,
  useVoiceSettings,
  useWakeLock,
  playSound,
  playVoiceSound,
  navigateTo,
} from '#imports'
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
import { createVoiceDiagnostics, type VoiceDiagnostics } from '~/utils/voice-diagnostics'

// One voice session per tab. `sid` tells the server (and our other tabs) which tab owns the account's session.
const sid = import.meta.client ? crypto.randomUUID() : ''
const channelId = ref<string | null>(null)
const connecting = ref(false)
const pendingChannelId = ref<string | null>(null)
const connection = ref<'disconnected' | 'connected' | 'reconnecting' | 'signalReconnecting'>('disconnected')
const audioBlocked = ref(false)
let playbackNeedsRetry = false
let playbackFailureEpoch = 0
let microphoneAudioBlocked = false
const microphone = ref<'idle' | 'starting' | 'ready' | 'unavailable'>('idle')
let pendingMicrophone: AbortController | undefined
const retryChannelId = ref<string | null>(null)
const mute = ref(initialMute())
const presence = ref<Record<string, VoiceMember>>({})
const devices = ref<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({ mics: [], speakers: [], cams: [] })
const canPickOutput = import.meta.client && 'setSinkId' in HTMLMediaElement.prototype
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
const pingHistory = ref<{ time: number; ping: number | null }[]>([])
const diagnostics = ref<VoiceDiagnostics | null>(null)
let pingEpoch = 0
const radioListening = ref(false)
const camOn = ref(false)
const screenOn = ref(false)
const screenBusy = ref(false)
let screenEpoch = 0
type ScreenSession = { video: LocalVideoTrack; audio?: LocalAudioTrack; publication?: LocalVideoTrack }
let screenSession: ScreenSession | undefined
// Stop/leave must reach accepted replacement capture even while publication is pending.
let pendingScreenSession: ScreenSession | undefined
const volumeFor = ref<string | null>(null)
const volumes = import.meta.client ? useLocalStorage<Record<string, Partial<UserVolume>>>('spk:user-volumes', {}) : ref<Record<string, Partial<UserVolume>>>({})
let room: Room | undefined
const outputListeners = new Map<RemoteAudioTrack, () => void>()
let appliedCameraResolution: CameraResolution = 'auto'
// Speaking turns on at once but off only after this hold, so pauses between words don't flicker the ring.
export const SPEAKING_HOLD_MS = 500
const speakingIds = new Set<string>()
const speakingOff = new Map<string, ReturnType<typeof setTimeout>>()
let processor: MicProcessor | undefined
let pendingJoin: AbortController | undefined
let pendingJoinDone: Promise<void> | undefined
let moveEpoch = 0
const updateVoiceKey = 'spk:update-voice'
let reloadingForUpdate = false
let restoreAudioSession: (() => void) | undefined

function startCallAudioSession() {
  // Audio Session is not yet in TypeScript's DOM types; intent applies to the whole page.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  const previous = session.type
  try {
    session.type = 'play-and-record'
  } catch (e) {
    console.warn('Could not set call audio intent', e)
    return
  }
  let restored = false
  return () => {
    if (restored) return
    restored = true
    try {
      session.type = previous
    } catch (e) {
      console.warn('Could not restore audio intent', e)
    }
  }
}

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
  function updateAudioBlocked(r = room) {
    if (r) audioBlocked.value = playbackNeedsRetry || microphoneAudioBlocked || !r.canPlaybackAudio
  }
  function notePlaybackFailure() {
    playbackNeedsRetry = true
    playbackFailureEpoch++
    audioBlocked.value = true
  }
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
  let lastSent = 0
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
      muted: mute.value.muted || microphone.value !== 'ready',
      deafened: mute.value.deafened,
      speaking: speakingIds.has(me.value?.id ?? '') && !mute.value.muted,
      cam: camOn.value,
      screen: screenOn.value,
      radioListening: radioListening.value,
      watching: watching.value,
    })
  }

  const outputKind = (source: Track.Source): 'speaker' | 'mediaSpeaker' => (source === 'screen_share_audio' ? 'mediaSpeaker' : 'speaker')
  async function routeOutput(track: RemoteAudioTrack, kind = outputKind(track.source)) {
    if (!canPickOutput) return
    const device = matchDevice(settings.value[kind], devices.value.speakers).deviceId ?? ''
    try {
      await track.setSinkId(device)
    } catch (e) {
      toast.add({ title: 'Could not switch device', description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    }
    if (device !== (matchDevice(settings.value[kind], devices.value.speakers).deviceId ?? '')) await routeOutput(track, kind)
  }

  function forgetTrackOutput(track: RemoteAudioTrack) {
    outputListeners.get(track)?.()
    outputListeners.delete(track)
  }
  function clearOutputListeners() {
    for (const track of outputListeners.keys()) forgetTrackOutput(track)
  }
  function applyTrackOutput(track: RemoteAudioTrack, identity: string, source: Track.Source) {
    if (!outputListeners.has(track)) {
      // Room unmute events can be buffered during signaling recovery; the track event is synchronous.
      const listener = () => applyTrackOutput(track, identity, source)
      track.on('unmuted', listener)
      // The room suppresses repeated failures while already blocked; count every track failure during retries.
      track.on('audioPlaybackFailed', notePlaybackFailure)
      outputListeners.set(track, () => {
        track.off('unmuted', listener)
        track.off('audioPlaybackFailed', notePlaybackFailure)
      })
    }
    const volume = effectiveVolume(
      mute.value.deafened,
      userVolume(volumes.value, identity),
      source === 'screen_share_audio' ? 'screen' : 'mic',
      settings.value.outputVolume,
    )
    // Element volume is ignored on some browsers (notably iOS); gate the received audio itself.
    track.mediaStreamTrack.enabled = volume > 0 && !track.isMuted
    track.setVolume(volume)
  }
  function applyOutput() {
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.track) applyTrackOutput(pub.track as RemoteAudioTrack, p.identity, pub.source)
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
  function attachAudio(track: RemoteAudioTrack) {
    if (!track.attachedElements.some(e => e.isConnected)) document.body.append(track.attach())
  }

  let pruneQueued = false
  function pruneWatching() {
    if (pruneQueued) return
    const r = room
    pruneQueued = true
    queueMicrotask(() => {
      pruneQueued = false
      if (!r || room !== r || connection.value === 'reconnecting' || r.state === 'reconnecting') return
      const remaining = watching.value.filter(id => r.remoteParticipants.has(id))
      if (remaining.length !== watching.value.length) {
        watching.value = remaining
        pushState()
      }
      if (theater.value && theater.value !== r.localParticipant.identity && !r.remoteParticipants.has(theater.value)) theater.value = null
    })
  }

  function rebuild() {
    if (!room) {
      tiles.value = []
      camOn.value = screenOn.value = false
      theater.value = null
      return
    }
    // LiveKit removes participants synchronously before announcing a full reconnect.
    pruneWatching()
    const recovering = room.state === 'reconnecting' || connection.value === 'reconnecting'
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
    const focused = tiles.value.find(t => t.userId === theater.value)
    if (!recovering && focused && !focused.camLive && !focused.screenLive) theater.value = null
    const [cam, screen] = [tiles.value[0]!.camLive, tiles.value[0]!.screenLive]
    const changed = cam !== camOn.value || screen !== screenOn.value
    camOn.value = cam
    screenOn.value = screen
    if (changed) pushState()
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

  function reloadForUpdate() {
    try {
      if (channelId.value) sessionStorage.setItem(updateVoiceKey, JSON.stringify({ userId: me.value?.id, channelId: channelId.value, mute: mute.value }))
      else sessionStorage.removeItem(updateVoiceKey)
    } catch {
      toast.add({ title: 'Could not prepare update. Please try again.', color: 'error' })
      return
    }
    reloadingForUpdate = true
    window.location.reload()
  }

  async function enableMicrophone(permission?: Promise<undefined | Error>, r = room, connected?: Promise<void>) {
    if (!r || pendingMicrophone || microphone.value === 'ready') return
    const attempt = new AbortController()
    pendingMicrophone = attempt
    const { signal } = attempt
    microphone.value = 'starting'
    let track: LocalAudioTrack | undefined
    let nextProcessor: MicProcessor | undefined
    const stop = () => {
      track?.stop()
      // LiveKit does not own the processor until setProcessor finishes.
      void nextProcessor?.destroy().catch(e => console.warn('Could not release microphone processor', e))
    }
    signal.addEventListener('abort', stop, { once: true })
    try {
      const [error, { MicProcessor }] = await Promise.all([
        permission ??
          allowMicrophone().then(
            () => undefined,
            () => new Error('Microphone access was denied'),
          ),
        import('~/utils/voice-processor'),
      ])
      signal.throwIfAborted()
      if (error) throw error
      const mic = matchDevice(settings.value.mic, devices.value.mics)
      if (mic.deviceId) await r.switchActiveDevice('audioinput', mic.deviceId, false)
      signal.throwIfAborted()
      const tracks = await r.localParticipant.createTracks({ audio: captureOptions(mic.deviceId) })
      track = tracks[0] as LocalAudioTrack
      signal.throwIfAborted()
      nextProcessor = new MicProcessor(
        processing(),
        blocked => {
          if (processor !== nextProcessor || (pendingMicrophone !== attempt && room !== r)) return
          microphoneAudioBlocked = blocked
          updateAudioBlocked(r)
        },
        signal,
      )
      processor = nextProcessor // Recovery must reach the context even while setProcessor is waiting for activation.
      try {
        await track.setProcessor(nextProcessor)
      } catch (e) {
        await nextProcessor.destroy()
        if (processor === nextProcessor) processor = undefined
        throw e
      }
      signal.throwIfAborted()
      track.stopOnMute = true
      await connected // Prepare during connection, but never publish before the session is established.
      signal.throwIfAborted()
      if (mute.value.muted) await track.mute()
      signal.throwIfAborted()
      await r.localParticipant.publishTrack(track)
      signal.throwIfAborted()
      microphone.value = 'ready'
      applyMute()
    } catch (e) {
      track?.stop() // Capture can finish after leaving; unpublished tracks need explicit cleanup.
      await connected?.catch(() => {})
      if (!signal.aborted && room === r) {
        microphone.value = 'unavailable'
        pushState()
        toast.add({ title: 'Microphone unavailable. You can still listen.', description: (e as Error).message, color: 'warning', icon: 'i-lucide-mic-off' })
      }
    } finally {
      signal.removeEventListener('abort', stop)
      if (pendingMicrophone === attempt) pendingMicrophone = undefined
    }
  }

  async function join(id: string) {
    if (channelId.value === id || connecting.value) return
    connecting.value = true
    const leaving = channelId.value ? leave(false) : undefined
    const epoch = ++moveEpoch
    pendingChannelId.value = id
    let settled!: () => void
    pendingJoinDone = new Promise(resolve => {
      settled = resolve
    })
    if (leaving) await leaving
    if (epoch !== moveEpoch) {
      pendingJoinDone = undefined
      connecting.value = false
      settled()
      return
    }
    retryChannelId.value = null
    const attempt = new AbortController()
    pendingJoin = attempt
    const signal = attempt.signal
    let r: Room | undefined
    let claimed = false
    const stopSocketWatch = watchSocket(
      socket.connected,
      on => {
        if (!on) attempt.abort(new Error('Voice socket disconnected'))
      },
      { flush: 'sync' },
    )
    const cancel = () => {
      pendingChannelId.value = null
      clearOutputListeners()
      if (claimed) socket.send({ type: 'voice:leave', sid })
      void r?.disconnect()
    }
    signal.addEventListener('abort', cancel, { once: true })
    const restoreSession = startCallAudioSession()
    restoreAudioSession = restoreSession
    try {
      // Permission must not block listening. Keep its error handled until microphone setup can use it.
      const permission = allowMicrophone().then(
        () => undefined,
        () => new Error('Microphone access was denied'),
      )
      const [{ token, url }, { Room, RoomEvent, Track, DisconnectReason }] = await Promise.all([
        $fetch<{ token: string; url: string }>('/api/voice/token', { method: 'POST', body: { channelId: id }, signal }),
        import('livekit-client'),
      ])
      signal.throwIfAborted()
      r = new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: false, // beforeunload can be cancelled; pagehide handles departure.
        publishDefaults: VOICE_PUBLISH_DEFAULTS,
        videoCaptureDefaults: cameraConstraints(settings.value.cameraResolution),
        audioCaptureDefaults: captureOptions(),
      })
      r.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (signal.aborted || (room !== r && pendingJoin !== attempt) || track.kind !== Track.Kind.Audio || publication.track !== track) return
        applyTrackOutput(track as RemoteAudioTrack, participant.identity, publication.source)
        attachAudio(track as RemoteAudioTrack) // remote audio only plays while attached to an element
        void routeOutput(track as RemoteAudioTrack)
      })
      // Firefox: LiveKit's own default-device pick sets every remote sink on devicechange; restore ours.
      r.on(RoomEvent.ActiveDeviceChanged, kind => {
        if (signal.aborted || (room !== r && pendingJoin !== attempt)) return
        if (kind === 'audiooutput') {
          void routeOutputs('speaker')
          void routeOutputs('mediaSpeaker')
        }
      })
      r.on(RoomEvent.TrackUnsubscribed, track => {
        if (track.kind === Track.Kind.Audio) forgetTrackOutput(track as RemoteAudioTrack)
        track.detach().forEach(e => e.remove())
        // LiveKit clears/replaces publication.track only after emitting unsubscribe.
        queueMicrotask(() => {
          if (!signal.aborted && (room === r || pendingJoin === attempt)) rebuild()
        })
      })
      r.on(RoomEvent.ActiveSpeakersChanged, list => {
        if (signal.aborted || (room !== r && pendingJoin !== attempt)) return
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
              pushState()
              rebuild()
            }, SPEAKING_HOLD_MS),
          )
        }
        pushState()
        rebuild()
      })
      for (const ev of [
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
      ] as const)
        r.on(ev, () => {
          if (!signal.aborted && (room === r || pendingJoin === attempt)) rebuild()
        })
      const interrupted = (state: 'reconnecting' | 'signalReconnecting') => {
        if (room !== r) return
        if (connection.value === 'connected')
          toast.add({
            title: state === 'reconnecting' ? 'Voice interrupted. Reconnecting…' : 'Voice signaling reconnecting. Audio may still work.',
            color: 'warning',
          })
        if (connection.value !== 'reconnecting') connection.value = state
        stopPing(false)
        clearSpeaking()
        pushState()
        rebuild()
      }
      r.on(RoomEvent.SignalReconnecting, () => interrupted('signalReconnecting'))
      r.on(RoomEvent.Reconnecting, () => interrupted('reconnecting'))
      r.on(RoomEvent.Reconnected, () => {
        if (!r || room !== r) return
        const recovered = connection.value !== 'connected'
        connection.value = 'connected'
        rebuild()
        for (const p of r.remoteParticipants.values())
          for (const pub of p.audioTrackPublications.values()) {
            if (pub.audioTrack) attachAudio(pub.audioTrack as RemoteAudioTrack)
          }
        void Promise.all([routeOutputs('speaker'), routeOutputs('mediaSpeaker')]).then(() => {
          if (room !== r) return
          applyOutput()
        })
        updateAudioBlocked(r)
        socket.send({ type: 'voice:ready', sid })
        lastSent = 0
        pushState()
        startPing(r)
        if (recovered) toast.add({ title: 'Voice connection restored', color: 'success', icon: 'i-lucide-wifi' })
      })
      r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!r || room !== r) return
        // Context-only SDK success can arrive after an element failed; only a successful retry clears the failure.
        if (!r.canPlaybackAudio) notePlaybackFailure()
        updateAudioBlocked(r)
      })
      r.on(RoomEvent.Disconnected, reason => {
        if (room === r) {
          const retry =
            reason === undefined ||
            [
              DisconnectReason.UNKNOWN_REASON,
              DisconnectReason.SIGNAL_CLOSE,
              DisconnectReason.STATE_MISMATCH,
              DisconnectReason.CONNECTION_TIMEOUT,
              DisconnectReason.SERVER_SHUTDOWN,
              DisconnectReason.MEDIA_FAILURE,
            ].includes(reason)
          void leave(false, 'You were disconnected from voice')
          if (retry) retryChannelId.value = id
        } else if (pendingJoin === attempt) attempt.abort(new Error('You were disconnected from voice'))
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
        claimed = socket.send({ type: 'voice:join', channelId: id, sid, nonce, muted: true, deafened: mute.value.deafened, watching: [] })
        if (!claimed) finish(new Error('Voice socket is not connected'))
      })
      signal.throwIfAborted()
      const connected = r.connect(url, token, { autoSubscribe: false })
      void enableMicrophone(permission, r, connected)
      await connected
      signal.throwIfAborted()
      room = r
      connection.value = 'connected'
      updateAudioBlocked(r)
      channelId.value = id
      pendingChannelId.value = null
      rebuild()
      socket.send({ type: 'voice:ready', sid }) // Listening is ready; the microphone can follow later.
      lastSent = 0
      pushState()
      startPing(r)
      playVoiceSound('join')
      void enableAudio()
    } catch (e) {
      pendingChannelId.value = null
      restoreSession?.()
      clearOutputListeners()
      pendingMicrophone?.abort()
      pendingMicrophone = undefined
      microphone.value = 'idle'
      processor = undefined
      playbackNeedsRetry = microphoneAudioBlocked = audioBlocked.value = false
      if (claimed) socket.send({ type: 'voice:leave', sid })
      pendingJoin = undefined
      clearSpeaking()
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
      pendingChannelId.value = null
      connecting.value = false
      settled()
    }
  }

  function startPing(r: Room) {
    stopPing(false)
    const epoch = pingEpoch
    const collect = createVoiceDiagnostics(r)
    let reading = false
    const read = async () => {
      if (reading) return
      reading = true
      try {
        // shortcut: `engine.client.rtt` is LiveKit-internal; switch to a public API when one exists.
        const rtt = (r as unknown as { engine?: { client?: { rtt?: number } } }).engine?.client?.rtt
        const sample = await collect()
        if (epoch !== pingEpoch) return
        ping.value = typeof rtt === 'number' && Number.isFinite(rtt) && rtt >= 0 ? Math.round(rtt) : null
        diagnostics.value = sample
        const time = Date.now()
        const boundary = pingHistory.value.findLastIndex(p => p.time < time - 62_000)
        pingHistory.value = [...pingHistory.value.slice(Math.max(0, boundary)), { time, ping: ping.value }].slice(-33)
      } finally {
        reading = false
      }
    }
    void read()
    pingTimer = setInterval(() => {
      void read()
    }, 2000)
  }
  function stopPing(clearHistory = true) {
    pingEpoch++
    clearInterval(pingTimer)
    pingTimer = undefined
    ping.value = null
    diagnostics.value = null
    if (clearHistory) pingHistory.value = []
    else pingHistory.value = [...pingHistory.value, { time: Date.now(), ping: null }].slice(-33)
  }

  function clearSpeaking() {
    speakingOff.forEach(clearTimeout)
    speakingOff.clear()
    speakingIds.clear()
  }

  async function move(id: string) {
    const epoch = ++moveEpoch
    const done = pendingJoinDone
    pendingChannelId.value = null
    pendingJoin?.abort()
    if (done) await done
    if (epoch !== moveEpoch) return
    await join(id)
  }

  async function leave(sound = true, reason?: string) {
    moveEpoch++
    pendingChannelId.value = null
    retryChannelId.value = null
    connection.value = 'disconnected'
    playbackNeedsRetry = microphoneAudioBlocked = audioBlocked.value = false
    pendingMicrophone?.abort()
    pendingMicrophone = undefined
    microphone.value = 'idle'
    const pending = pendingJoin
    pending?.abort()
    restoreAudioSession?.()
    restoreAudioSession = undefined
    const r = room
    processor = undefined
    if (!r && !channelId.value && !pending) return
    screenEpoch++
    for (const s of [screenSession, pendingScreenSession]) {
      if (s) for (const t of screenTracks(s)) t.stop()
    }
    screenSession = pendingScreenSession = undefined
    room = undefined
    clearOutputListeners()
    for (const p of r?.remoteParticipants.values() ?? []) for (const pub of p.audioTrackPublications.values()) pub.audioTrack?.detach().forEach(e => e.remove())
    clearSpeaking()
    watching.value = []
    theater.value = null
    stopPing()
    const was = channelId.value
    channelId.value = null
    if (was) socket.send({ type: 'voice:leave', sid })
    await r?.disconnect()
    rebuild()
    if (sound) playVoiceSound('leave')
    if (reason) toast.add({ title: reason, color: 'warning', icon: 'i-lucide-phone-off' })
  }

  async function enableAudio() {
    const r = room
    if (!r) return
    const failureEpoch = playbackFailureEpoch
    try {
      // Start both resumes before awaiting: mobile browsers require the original tap's activation.
      await Promise.all([r.startAudio(), processor?.resume()])
      if (room !== r) return
      if (playbackFailureEpoch === failureEpoch) playbackNeedsRetry = false
      updateAudioBlocked(r)
    } catch (e) {
      if (room !== r) return
      notePlaybackFailure()
      toast.add({ title: 'Could not enable audio', description: (e as Error).message, color: 'error' })
    }
  }

  async function reconnect() {
    if (connecting.value) return
    const id = channelId.value ?? retryChannelId.value
    if (!id) return
    connecting.value = true
    const leaving = leave(false)
    const epoch = moveEpoch
    await leaving
    connecting.value = false
    // A leave, move or takeover during teardown cancels this explicit retry.
    if (epoch !== moveEpoch) return
    await join(id)
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
  const routeOutputs = (kind: 'speaker' | 'mediaSpeaker') =>
    Promise.all(
      [...(room?.remoteParticipants.values() ?? [])].flatMap(p =>
        [...p.audioTrackPublications.values()]
          .filter(pub => pub.track && outputKind(pub.source) === kind)
          .map(pub => routeOutput(pub.track as RemoteAudioTrack, kind)),
      ),
    )
  async function pickDevice(kind: 'mic' | 'speaker' | 'mediaSpeaker' | 'camera', d: SavedDevice) {
    const output = kind === 'speaker' || kind === 'mediaSpeaker'
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
    else void startScreen()
  }
  const watch = (id: string, on: boolean) => {
    watching.value = on ? [...new Set([...watching.value, id])] : watching.value.filter(x => x !== id)
    if (on) theater.value = id
    else if (theater.value === id) theater.value = null
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
    pendingChannelId,
    connecting,
    connection,
    audioBlocked,
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
    enableAudio,
    enableMicrophone: () => enableMicrophone(),
    reconnect,
    syncState: () => {
      lastSent = 0
      pushState()
    },
    setRadioListening: (listening: boolean) => {
      if (radioListening.value === listening) return
      radioListening.value = listening
      pushState()
    },
    mute,
    devices,
    canPickOutput,
    settings,
    tiles: computed(() => {
      const remote = new Map(tiles.value.filter(t => !t.local).map(t => [t.userId, t]))
      return [
        ...tiles.value.filter(t => t.local),
        ...Object.entries(presence.value).flatMap(([id, member]) => {
          const tile = remote.get(id)
          if (tile) return [tile]
          // Presence survives browser handoffs and media reconnects; keep the avatar until tracks return.
          if (!channelId.value || member.channelId !== channelId.value || id === me.value?.id) return []
          return [{ userId: id, local: false, speaking: false, camLive: false, screenLive: false, screenAudio: false, watching: watching.value.includes(id) }]
        }),
      ]
    }),
    watching,
    theater,
    playing,
    ping,
    pingHistory,
    diagnostics,
    watchStream,
    camOn,
    screenOn,
    screenBusy,
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
    reloadForUpdate,
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

/** Display only: never use optimistic membership for media or server actions. */
export function voiceDisplayMembers(id: string, selfId?: string) {
  const members = voiceMembers(id).map(m => ({ ...m, pending: false }))
  if (pendingChannelId.value !== id || !selfId) return members
  const pending = {
    userId: selfId,
    channelId: id,
    pending: true,
    muted: false,
    deafened: false,
    speaking: false,
    cam: false,
    screen: false,
    radioListening: false,
    watching: [] as string[],
  }
  const index = members.findIndex(m => m.userId === selfId)
  if (index === -1) members.push(pending)
  else members[index] = pending
  return members
}

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
  onMounted(() => {
    // Warm browser code only; permission and capture still require joining.
    void Promise.all([import('livekit-client'), import('~/utils/voice-processor')]).catch(() => {})
    void load()
  })
  onMounted(() => {
    let intent: { userId: string; channelId: string; mute: typeof mute.value; reloadOnly?: boolean } | null
    try {
      const saved = sessionStorage.getItem(updateVoiceKey)
      sessionStorage.removeItem(updateVoiceKey) // Consume before joining, including when the join fails.
      intent = saved ? JSON.parse(saved) : null
    } catch {
      return
    }
    if (
      !intent ||
      (intent.reloadOnly && (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type !== 'reload') ||
      typeof intent.userId !== 'string' ||
      typeof intent.channelId !== 'string' ||
      typeof intent.mute?.muted !== 'boolean' ||
      typeof intent.mute?.deafened !== 'boolean' ||
      typeof intent.mute?.restore !== 'boolean' ||
      (intent.mute.deafened && !intent.mute.muted)
    )
      return
    watch(
      () => socket.connected.value && !!v.me.value,
      ready => {
        if (!ready || !intent) return
        const saved = intent
        intent = null
        if (saved.userId !== v.me.value?.id || v.channelId.value || v.connecting.value) return
        v.mute.value = saved.mute
        void v.join(saved.channelId)
      },
      { immediate: true },
    )
  })
  socket.onOpen(() => {
    void load()
    // Reclaim the existing session without dropping voice presence during app socket recovery.
    if (v.channelId.value)
      socket.send({
        type: 'voice:join',
        channelId: v.channelId.value,
        sid,
        muted: v.mute.value.muted || v.microphone.value !== 'ready',
        deafened: v.mute.value.deafened,
        watching: v.watching.value,
        ready: v.connection.value === 'connected' || v.connection.value === 'signalReconnecting',
      })
    v.syncState()
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
          radioListening: !!m.radioListening,
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
    } else if (m.type === 'voice:disconnect' && m.sid === sid && (v.channelId.value || v.connecting.value || v.retryChannelId.value)) {
      void v.leave(false, m.reason)
    } else if (m.type === 'voice:move' && m.sid === sid && (v.channelId.value || v.connecting.value)) {
      // Settle a pending connection before joining the admin's destination.
      void v.move(m.channelId).then(() => {
        if (v.channelId.value === m.channelId) {
          useToast().add({ title: 'An admin moved you to another voice channel', color: 'warning', icon: 'i-lucide-move-right' })
          void navigateTo(`/c/${m.channelId}`)
        }
      })
    } else if (m.type === 'voice:kicked' && m.sid !== sid && (v.channelId.value || v.connecting.value || v.retryChannelId.value)) {
      void v.leave(false, 'You joined voice from another tab or device')
    }
  })
  useEventListener(window, 'beforeunload', e => {
    if (v.channelId.value && !reloadingForUpdate) e.preventDefault()
  })
  useEventListener(window, 'pagehide', () => {
    if (!reloadingForUpdate) {
      try {
        if (v.channelId.value)
          sessionStorage.setItem(updateVoiceKey, JSON.stringify({ userId: v.me.value?.id, channelId: v.channelId.value, mute: v.mute.value, reloadOnly: true }))
        else sessionStorage.removeItem(updateVoiceKey)
      } catch {
        // Storage can be unavailable; still release media and presence.
      }
    }
    void v.leave(false)
  })
  // Keep the machine awake during a call; the browser drops the lock while the tab is hidden.
  const wakeLock = useWakeLock()
  watch(
    () => !!v.channelId.value,
    on => (on ? wakeLock.request('screen') : wakeLock.release()).catch(() => {}),
  )
  useEventListener(navigator.mediaDevices, 'devicechange', async () => {
    const outputs = (['speaker', 'mediaSpeaker'] as const).map(kind => ({
      kind,
      active: matchDevice(v.settings.value[kind], devices.value.speakers).deviceId,
    }))
    const micBefore = matchDevice(v.settings.value.mic, devices.value.mics).deviceId
    const defaultLabel = devices.value.mics.find(d => d.deviceId === 'default')?.label
    await v.refreshDevices()
    const r = v.activeRoom()
    if (v.canPickOutput)
      for (const { kind, active } of outputs) {
        if (kind === 'speaker' && !r) continue
        const saved = v.settings.value[kind]
        if (!saved) continue
        const now = matchDevice(saved, devices.value.speakers).deviceId
        if (active === now) continue
        await v.routeOutputs(kind)
        if (!!active === !!now) continue
        const name = kind === 'speaker' ? 'voice output' : 'media output'
        useToast().add(
          now
            ? { title: `Switched back to ${saved.label}`, description: `Your ${name} is back.`, icon: 'i-lucide-headphones', color: 'info' }
            : { title: `Your ${name} was unplugged`, description: 'Switched to the default device.', icon: 'i-lucide-headphones', color: 'warning' },
        )
      }
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
  })
  onMounted(() => v.refreshDevices())
}
