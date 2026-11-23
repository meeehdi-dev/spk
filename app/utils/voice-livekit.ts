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
import { MAX_SOUND_MS, SOUND_REST_MS } from '#shared/utils/sounds'
import {
  effectiveVolume,
  initialMute,
  matchDevice,
  cameraConstraints,
  isCameraResolution,
  type CameraResolution,
  SCREEN_AUDIO_CAPTURE,
  SCREEN_AUDIO_PUBLISH,
  SCREEN_FPS,
  SCREEN_HEIGHTS,
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
import { LOST_MS, report, outageStart, type OutageKind, type OutageStart } from '~/utils/socket-browser'
import { createTrackAudio } from '~/utils/track-audio'
import { createVoiceDiagnostics, readIncomingAudio, type VoiceDiagnostics } from '~/utils/voice-diagnostics'

// One voice session per tab. `sid` tells the server (and our other tabs) which tab owns the account's session.
const sid = import.meta.client ? crypto.randomUUID() : ''
const channelId = ref<string | null>(null)
const connecting = ref(false)
const pendingChannelId = ref<string | null>(null)
const connection = ref<'disconnected' | 'connected' | 'reconnecting' | 'signalReconnecting'>('disconnected')
const audioBlocked = ref(false)
/** True once a media or signal reconnect has lasted LOST_MS; brief interruptions never set it. */
const lost = ref(false)
let lostTimer: ReturnType<typeof setTimeout> | undefined
let voiceDown: (OutageStart & { kind: OutageKind }) | undefined
let playbackNeedsRetry = false
let playbackFailureEpoch = 0
let microphoneAudioBlocked = false
const microphone = ref<'idle' | 'starting' | 'ready' | 'unavailable'>('idle')
let pendingMicrophone: AbortController | undefined
// The session's single mic track; LiveKit keeps the same object across republish.
let micPub: LocalAudioTrack | undefined
/** Members I can't hear (watchdog): missing, unsubscribed or stalled for 4 s while unmuted. */
const unheard = ref<Set<string>>(new Set())
/** Channel id while an automatic rejoin is running. */
const rejoining = ref<string | null>(null)
// Per bad member: when it began, and whether the one resubscribe was spent.
const episodes = new Map<string, { since: number; resubscribed: boolean }>()
let lastWatchdogRejoin = 0
let rejoinError: unknown // why the last quiet rejoin attempt failed
let healing = false
const packets = new WeakMap<object, number>() // last inbound packetsReceived per remote track
const REJOIN_DELAYS = [1000, 3000, 8000]
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const DEVICE_SETTLE_MS = 300
const AUDIO_RESUME_MS = 3000
let stopVisibleHeal: (() => void) | undefined
const retryChannelId = ref<string | null>(null)
const mute = ref(initialMute())
const presence = ref<Record<string, VoiceMember>>({})
const devices = ref<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({ mics: [], speakers: [], cams: [] })
const canPickOutput = import.meta.client && 'setSinkId' in HTMLMediaElement.prototype
const tiles = shallowRef<VoiceTile[]>([])
const watching = ref<string[]>([])
/** The tile shown large; shared voice state so it survives navigating away from the channel. */
const theater = ref<string | null>(null)
/** A quality change republishes the stream; keep theater through that gap. */
const THEATER_GRACE_MS = 3000
let theaterTimer: { id: string | null; timer: ReturnType<typeof setTimeout> } | undefined
/** Sound icon per user while their soundboard sound plays. */
const playing = ref<Record<string, string>>({})
const playingOff = new Map<string, ReturnType<typeof setTimeout>>()
/** True for SOUND_REST_MS after your own sound ends, so others get the next turn. */
const soundRest = ref(false)
let soundRestTimer: ReturnType<typeof setTimeout> | undefined
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
const trackAudio = createTrackAudio(notePlaybackFailure)

function notePlaybackFailure() {
  playbackNeedsRetry = true
  playbackFailureEpoch++
  audioBlocked.value = true
}
let appliedCameraResolution: CameraResolution = 'auto'
// Speaking turns on at once but off only after this hold, so pauses between words don't flicker the ring.
export const SPEAKING_HOLD_MS = 500
const speakingIds = new Set<string>()
const speakingOff = new Map<string, ReturnType<typeof setTimeout>>()
let processor: MicProcessor | undefined
let opened: { options: string; device?: string } = { options: '' } // what the live mic was opened with, see micTarget
let micQueue = Promise.resolve()
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
  // Windows Chromium's 'communications' entry duplicates a real device; it is not a choice.
  const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.deviceId && d.deviceId !== 'communications')
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

  const micTrack = () => (room ? micPub : undefined)
  const trackDiag = (cause: string, track?: string) => report(outageStart(), { kind: 'voiceTrack', cause, lost: false, track })
  const processing = () => ({ enhanced: settings.value.noise === 'enhanced', thresholdDb: sensitivityToDb(settings.value.sensitivity) })
  function updateAudioBlocked(r = room) {
    if (r) audioBlocked.value = playbackNeedsRetry || microphoneAudioBlocked || !r.canPlaybackAudio
  }
  const captureOptions = (deviceId?: string) => ({
    deviceId,
    echoCancellation: settings.value.echo,
    autoGainControl: settings.value.agc,
    noiseSuppression: settings.value.noise === 'standard',
    channelCount: 1,
  })

  // An old saved 'default' (Chromium's entry) means System default too.
  const savedMic = () => (settings.value.mic?.deviceId === 'default' ? undefined : settings.value.mic)
  /** The mic to open: the saved one, else the OS default. Leaving deviceId unset lets the browser pick its current default instead of pinning the old device. */
  function micTarget() {
    const mics = devices.value.mics
    const deviceId = matchDevice(savedMic(), mics).deviceId
    // The OS default is Chromium's 'default' entry (same id, new label) or the first input elsewhere (Firefox, Safari list it first).
    const chromium = mics.find(d => d.deviceId === 'default')
    const capture = captureOptions(deviceId)
    return { capture, options: JSON.stringify(capture), device: deviceId ?? (chromium ? `default:${chromium.label}` : mics[0]?.deviceId) }
  }

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
    trackAudio.forget(track)
  }
  function clearOutputListeners() {
    for (const track of outputListeners.keys()) forgetTrackOutput(track)
    trackAudio.close()
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
    // Runs on every output change. Not gated on isMuted: it can go stale after a missed unmute, and a muted remote sends nothing anyway.
    track.mediaStreamTrack.enabled = volume > 0
    trackAudio.volume(track, volume)
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
  const setUnheard = (next: Set<string>) => {
    if (next.size !== unheard.value.size || [...next].some(id => !unheard.value.has(id))) unheard.value = next
  }
  // Ping tick / tab visible: verify I hear every member in my channel. Wall-clock, so throttled timers only delay it.
  async function heal() {
    const r = room
    if (!r || connection.value !== 'connected' || healing) return
    healing = true
    try {
      const members = Object.entries(presence.value).filter(([id, m]) => id !== me.value?.id && m.channelId === channelId.value)
      const results = await Promise.all(
        members.map(async ([id, m]) => {
          const p = r.remoteParticipants.get(id)
          const pub = p && [...p.audioTrackPublications.values()].find(x => x.source === ('microphone' as Track.Source))
          const track = pub?.track as RemoteAudioTrack | undefined
          for (const e of track?.attachedElements ?? []) if (e.paused) e.play().catch(notePlaybackFailure)
          let bad = !p
          if (p && !m.muted) {
            if (!pub || !track || !pub.isSubscribed) bad = true
            else {
              // A failed or hung stats read counts as fine (n stays undefined) to avoid false alarms.
              // Bounded so a hung stats read cannot hold `healing` forever.
              let timer = 0
              const timeout = new Promise<undefined>(resolve => (timer = window.setTimeout(resolve, 1500)))
              const n = await Promise.race([
                readIncomingAudio(track).then(
                  s => s?.packetsReceived,
                  () => undefined,
                ),
                timeout,
              ]).finally(() => window.clearTimeout(timer))
              const before = packets.get(track)
              if (n !== undefined) packets.set(track, n)
              if (n !== undefined && before !== undefined && n <= before) bad = true
            }
          }
          return { id, bad, pub, audible: !!p && !m.muted }
        }),
      )
      if (room !== r || connection.value !== 'connected') return
      const now = Date.now()
      const next = new Set<string>()
      for (const id of episodes.keys()) if (!members.some(([m]) => m === id)) episodes.delete(id)
      for (const { id, bad, pub } of results) {
        if (!bad) {
          episodes.delete(id)
          continue
        }
        const episode = episodes.get(id) ?? { since: now, resubscribed: false }
        episodes.set(id, episode)
        const age = now - episode.since
        if (age >= 4000) next.add(id)
        if (age >= 8000 && !episode.resubscribed && pub) {
          episode.resubscribed = true
          pub.setSubscribed(false)
          pub.setSubscribed(true)
          trackDiag('resubscribed', pub.trackSid)
        }
      }
      // Only a fault on my side breaks every audible member at once; a missing or lone bad member could be theirs, so require two.
      const audible = results.filter(x => x.audible)
      if (
        audible.length >= 2 &&
        audible.every(x => x.bad && now - episodes.get(x.id)!.since >= 20_000) &&
        now - lastWatchdogRejoin >= 60_000 &&
        channelId.value
      ) {
        lastWatchdogRejoin = now
        trackDiag('watchdogRejoin')
        const channel = channelId.value
        void leave(false)
        void rejoin(channel)
        return
      }
      setUnheard(next)
    } finally {
      healing = false
    }
  }
  function attachAudio(track: RemoteAudioTrack) {
    trackAudio.attach(track)
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
      clearTimeout(theaterTimer?.timer)
      theaterTimer = undefined
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
    const id = theater.value,
      idle = () => {
        const t = tiles.value.find(t => t.userId === id)
        return !!t && !t.camLive && !t.screenLive
      }
    if (recovering || !idle() || theaterTimer?.id !== id) {
      clearTimeout(theaterTimer?.timer)
      theaterTimer = undefined
    }
    if (!recovering && idle())
      theaterTimer ??= {
        id,
        timer: setTimeout(() => {
          theaterTimer = undefined
          if (theater.value === id && idle()) theater.value = null
        }, THEATER_GRACE_MS),
      }
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
    const published = micPub && [...r.localParticipant.trackPublications.values()].find(p => p.track === micPub)
    if (published) {
      microphone.value = 'ready'
      applyMute()
      trackDiag('micReused', published.trackSid)
      return
    }
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
      const mic = matchDevice(savedMic(), devices.value.mics)
      if (mic.deviceId) await r.switchActiveDevice('audioinput', mic.deviceId, false)
      signal.throwIfAborted()
      opened = micTarget()
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
      await connected // Prepare during connection, but never publish before the session is established.
      signal.throwIfAborted()
      if (mute.value.muted) await track.mute()
      signal.throwIfAborted()
      await r.localParticipant.publishTrack(track)
      signal.throwIfAborted() // an aborted publish is unpublished below as an orphan
      micPub = track
      microphone.value = 'ready'
      applyMute()
    } catch (e) {
      track?.stop() // Capture can finish after leaving; unpublished tracks need explicit cleanup.
      const orphan = track && [...r.localParticipant.trackPublications.values()].find(p => p.track === track)
      if (orphan) {
        await r.localParticipant.unpublishTrack(track!).catch(() => {})
        trackDiag('micUnpublished', orphan.trackSid)
      }
      await connected?.catch(() => {})
      if (!signal.aborted && room === r) {
        console.warn('Microphone failed', (e as Error).message)
        trackDiag('micPublishFailed', orphan?.trackSid)
        microphone.value = 'unavailable'
        pushState()
        toast.add({ title: 'Microphone unavailable. You can still listen.', description: (e as Error).message, color: 'warning', icon: 'i-lucide-mic-off' })
      }
    } finally {
      signal.removeEventListener('abort', stop)
      if (pendingMicrophone === attempt) pendingMicrophone = undefined
    }
  }

  /** `quiet` is the auto-rejoin loop: no failure toast, no join sound, and it keeps `rejoining` alive. */
  async function join(id: string, quiet = false) {
    if (channelId.value === id || connecting.value) return
    if (!quiet) rejoining.value = null
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
    let stopHandshake = () => {}
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
      // Replace the server session before LiveKit can evict the previous browser; runs alongside the token fetch and import.
      const nonce = crypto.randomUUID()
      const handshake = new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          clearTimeout(timeout)
          off()
          signal.removeEventListener('abort', aborted)
          if (error) reject(error)
          else resolve()
        }
        stopHandshake = () => finish(new Error('Voice join cancelled'))
        const aborted = () => finish(signal.reason)
        const off = socket.on(m => {
          if (m.type === 'voice:joined' && m.sid === sid && m.channelId === id && m.nonce === nonce) finish()
        })
        const timeout = setTimeout(() => finish(new Error('Voice join timed out')), 5000)
        signal.addEventListener('abort', aborted, { once: true })
        claimed = socket.send({ type: 'voice:join', channelId: id, sid, nonce, muted: true, deafened: mute.value.deafened, watching: [] })
        if (!claimed) finish(new Error('Voice socket is not connected'))
      })
      handshake.catch(() => {}) // surfaced at the await below; keep a token failure from leaving it unhandled
      const [{ token, url }, { Room, RoomEvent, Track, DisconnectReason }] = await Promise.all([
        $fetch<{ token: string; url: string }>('/api/voice/token', { method: 'POST', body: { channelId: id }, signal }),
        import('livekit-client'),
      ])
      signal.throwIfAborted()
      r = new Room({
        adaptiveStream: true,
        dynacast: true,
        singlePeerConnection: false,
        disconnectOnPageLeave: false, // beforeunload can be cancelled; pagehide handles departure.
        publishDefaults: VOICE_PUBLISH_DEFAULTS,
        videoCaptureDefaults: cameraConstraints(settings.value.cameraResolution),
        audioCaptureDefaults: captureOptions(),
      })
      void r.prepareConnection(url, token).catch(() => {})
      r.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (signal.aborted || (room !== r && pendingJoin !== attempt) || track.kind !== Track.Kind.Audio || publication.track !== track) return
        applyTrackOutput(track as RemoteAudioTrack, participant.identity, publication.source)
        attachAudio(track as RemoteAudioTrack) // remote audio only plays while attached to an element
        void routeOutput(track as RemoteAudioTrack)
      })
      r.on(RoomEvent.TrackSubscriptionFailed, trackSid => {
        if (signal.aborted || (room !== r && pendingJoin !== attempt)) return
        trackDiag('subFailed', trackSid) // heal() retries once it has been bad long enough
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
        if (connection.value === 'connected') {
          voiceDown = { ...outageStart(), kind: 'voiceSignal' }
          clearTimeout(lostTimer)
          lostTimer = setTimeout(() => {
            if (room !== r || connection.value === 'connected') return
            lost.value = true
            toast.add({
              title: 'Reconnecting voice…',
              color: 'warning',
            })
          }, LOST_MS)
        }
        if (state === 'reconnecting' && voiceDown) voiceDown.kind = 'voice'
        if (connection.value !== 'reconnecting') connection.value = state
        episodes.clear() // bad spells from before the outage must not count after it
        setUnheard(new Set())
        stopPing(false)
        clearSpeaking()
        pushState()
        rebuild()
      }
      r.on(RoomEvent.SignalReconnecting, () => interrupted('signalReconnecting'))
      r.on(RoomEvent.Reconnecting, () => interrupted('reconnecting'))
      r.on(RoomEvent.Reconnected, () => {
        if (!r || room !== r) return
        const recovered = lost.value
        if (voiceDown) report(voiceDown, { kind: voiceDown.kind, cause: 'reconnected', lost: lost.value })
        endOutage()
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
          const start = voiceDown ?? { ...outageStart(), kind: 'voice' as const }
          report(start, { kind: start.kind, cause: reason === undefined ? 'unknown' : (DisconnectReason[reason] ?? String(reason)), lost: true })
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
          if (retry) {
            void leave(false)
            void rejoin(id)
          } else void leave(false, 'You were disconnected from voice')
        } else if (pendingJoin === attempt) attempt.abort(new Error('You were disconnected from voice'))
      })
      await handshake
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
      if (!quiet) playVoiceSound('join')
      void enableAudio()
    } catch (e) {
      stopHandshake()
      pendingChannelId.value = null
      restoreSession?.()
      clearOutputListeners()
      pendingMicrophone?.abort()
      pendingMicrophone = undefined
      microphone.value = 'idle'
      micPub = undefined
      processor = undefined
      playbackNeedsRetry = microphoneAudioBlocked = audioBlocked.value = false
      if (claimed) socket.send({ type: 'voice:leave', sid })
      pendingJoin = undefined
      clearSpeaking()
      await r?.disconnect()
      if (quiet) rejoinError = signal.aborted ? signal.reason : e
      if (!quiet && (!signal.aborted || signal.reason?.name !== 'AbortError')) {
        toast.add({
          title: 'Could not join voice',
          description: errorText(signal.aborted ? signal.reason : e),
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
      void heal()
    }, 2000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void heal()
    }
    document.addEventListener('visibilitychange', onVisible)
    stopVisibleHeal = () => document.removeEventListener('visibilitychange', onVisible)
  }
  function stopPing(clearHistory = true) {
    pingEpoch++
    clearInterval(pingTimer)
    pingTimer = undefined
    stopVisibleHeal?.()
    stopVisibleHeal = undefined
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

  function endOutage() {
    clearTimeout(lostTimer)
    voiceDown = undefined
    lost.value = false
  }

  async function leave(sound = true, reason?: string) {
    moveEpoch++
    endOutage()
    rejoining.value = null
    episodes.clear()
    setUnheard(new Set())
    pendingChannelId.value = null
    retryChannelId.value = null
    connection.value = 'disconnected'
    playbackNeedsRetry = microphoneAudioBlocked = audioBlocked.value = false
    pendingMicrophone?.abort()
    pendingMicrophone = undefined
    microphone.value = 'idle'
    micPub = undefined
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

  /** Auto-rejoin after a transport drop: three attempts with backoff, paused while the app socket is down; only leave/move/join clear it. */
  async function rejoin(id: string) {
    rejoining.value = id
    let fatal: Error | undefined
    for (const delay of REJOIN_DELAYS) {
      await sleep(delay)
      while (rejoining.value === id && !socket.connected.value) await sleep(500)
      if (rejoining.value !== id) return
      rejoinError = undefined
      await join(id, true)
      if (rejoining.value !== id) return
      if (channelId.value === id) {
        rejoining.value = null
        return
      }
      const status = (rejoinError as { statusCode?: number } | undefined)?.statusCode
      if (status && ((status >= 400 && status < 500) || status === 503)) {
        fatal = rejoinError as Error // retrying cannot help
        break
      }
    }
    rejoining.value = null
    retryChannelId.value = id
    toast.add({ title: 'You were disconnected from voice', description: errorText(fatal), color: 'warning', icon: 'i-lucide-phone-off' })
  }

  /** `quiet`: an automatic retry (after a device change), which shows nothing when it fails. */
  async function enableAudio(quiet = false) {
    const r = room
    if (!r) return
    const failureEpoch = playbackFailureEpoch
    try {
      // Start both resumes before awaiting: mobile browsers require the original tap's activation.
      // Bounded: a context bound to a device that is switching (Bluetooth profile change) can hang its resume.
      await Promise.race([
        Promise.all([r.startAudio(), processor?.resume(), trackAudio.resume()]),
        sleep(AUDIO_RESUME_MS).then(() => Promise.reject(new Error('Audio did not resume in time'))),
      ])
      if (room !== r) return
      if (playbackFailureEpoch === failureEpoch) playbackNeedsRetry = false
      updateAudioBlocked(r)
    } catch (e) {
      if (room !== r) return
      notePlaybackFailure()
      if (!quiet)
        toast.add({
          title: 'Could not enable audio',
          description: (e as Error).message,
          color: 'error',
          actions: [{ label: 'Rejoin', onClick: () => void reconnect() }],
        })
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

  /** Live changes from the dropdowns, the settings page and device changes. Reopens the mic only when its options or target device changed. */
  function applySettings() {
    if (!room) return Promise.resolve()
    void processor?.update(processing())
    applyOutput()
    // One reopen at a time: overlapping device events and picks must not reopen the mic twice.
    const run = micQueue.then(async () => {
      const track = micTrack()
      if (!track) return
      const next = micTarget()
      const live = track.getSourceTrackSettings().deviceId
      // LiveKit's own devicechange handler moves the input too: it may already be on the new default (never reopen twice),
      // or it may have moved a saved mic that was listed first onto the new first device (Firefox, Safari).
      const reopen =
        next.options !== opened.options ||
        (next.capture.deviceId ? !!live && live !== next.capture.deviceId : next.device !== opened.device && live !== next.device)
      if (reopen) await track.restartTrack(next.capture)
      opened = next
    })
    micQueue = run.catch(() => {})
    return run
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
      } else if (kind === 'mic') await applySettings()
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
  // Capture at the ceiling; each published clone is constrained down, since browsers may not raise a running capture's frame rate.
  const SCREEN_CAPTURE_MAX: ScreenQuality = { height: SCREEN_HEIGHTS.at(-1)!, fps: SCREEN_FPS.at(-1)! }
  const screenCapture = (quality: ScreenQuality, audio: boolean): ScreenShareCaptureOptions => ({
    audio: audio ? SCREEN_AUDIO_CAPTURE : false,
    resolution: { width: 0, height: 0 },
    contentHint: screenShareOptions(quality).contentHint,
    // `max` never upscales the surface; LiveKit's type only declares displaySurface.
    video: { displaySurface: 'monitor', ...screenConstraints(SCREEN_CAPTURE_MAX) } as { displaySurface: 'monitor' },
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
    await video.mediaStreamTrack.applyConstraints(screenConstraints(quality))
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
    lost,
    /** Speaker icon state: brief drops stay amber, only outages past LOST_MS (voice or app socket) turn red. */
    health: computed(() =>
      lost.value || socket.lost.value ? 'lost' : connection.value === 'connected' && !audioBlocked.value && socket.connected.value ? 'ok' : 'unstable',
    ),
    microphone,
    retryChannelId,
    unheard,
    rejoining,
    connectionLabel: computed(() => {
      if (rejoining.value || connection.value === 'reconnecting' || connection.value === 'signalReconnecting') return 'Reconnecting…'
      if (connecting.value) return 'Connecting…'
      if (audioBlocked.value) return 'Audio blocked'
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
    soundRest,
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

/** Shows a sound's icon for its duration (10 s at most), whatever your own audio settings. The soundboard stays disabled meanwhile, then rests for its player (`mine`). */
function showSound(userId: string, icon: string, durationMs: number, mine: boolean) {
  clearTimeout(playingOff.get(userId))
  clearTimeout(soundRestTimer)
  soundRest.value = false
  playing.value = { ...playing.value, [userId]: icon }
  playingOff.set(
    userId,
    setTimeout(
      () => {
        playingOff.delete(userId)
        const { [userId]: _gone, ...rest } = playing.value
        playing.value = rest
        if (!mine) return
        soundRest.value = true
        soundRestTimer = setTimeout(() => {
          soundRest.value = false
        }, SOUND_REST_MS)
      },
      Math.min(MAX_SOUND_MS, durationMs),
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
      if (sound) showSound(m.userId, `i-lucide-${sound.icon}`, sound.durationMs, m.userId === v.me.value?.id)
      if (v.channelId.value && !v.mute.value.deafened) void playSound(m.soundId)
    } else if (m.type === 'voice:disconnect' && m.sid === sid && (v.channelId.value || v.connecting.value || v.retryChannelId.value || v.rejoining.value)) {
      void v.leave(false, m.reason)
    } else if (m.type === 'voice:move' && m.sid === sid && (v.channelId.value || v.connecting.value)) {
      // Settle a pending connection before joining the admin's destination.
      void v.move(m.channelId).then(() => {
        if (v.channelId.value === m.channelId) {
          useToast().add({ title: 'An admin moved you to another voice channel', color: 'warning', icon: 'i-lucide-move-right' })
          void navigateTo(`/c/${m.channelId}`)
        }
      })
    } else if (m.type === 'voice:kicked' && m.sid !== sid && (v.channelId.value || v.connecting.value || v.retryChannelId.value || v.rejoining.value)) {
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
  // Bluetooth headsets go through several device lists while switching profile; act once the list has settled.
  let deviceEpoch = 0
  useEventListener(navigator.mediaDevices, 'devicechange', async () => {
    const epoch = ++deviceEpoch
    await sleep(DEVICE_SETTLE_MS)
    if (epoch !== deviceEpoch) return
    const outputs = (['speaker', 'mediaSpeaker'] as const).map(kind => ({
      kind,
      active: matchDevice(v.settings.value[kind], devices.value.speakers).deviceId,
    }))
    const savedMic = v.settings.value.mic?.deviceId === 'default' ? undefined : v.settings.value.mic
    const micBefore = matchDevice(savedMic, devices.value.mics).deviceId
    await v.refreshDevices()
    const r = v.activeRoom()
    if (v.canPickOutput)
      for (const { kind, active } of outputs) {
        if (kind === 'speaker' && !r) continue
        const saved = v.settings.value[kind]
        if (!saved) continue // '' already follows the OS default output
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
    // Device switches can suspend audio contexts; retry once settled instead of leaving the "Audio blocked" banner to a click.
    if (v.audioBlocked.value) void v.enableAudio(true)
    const micNow = matchDevice(savedMic, devices.value.mics).deviceId
    try {
      await v.applySettings() // follows a new OS default, an unplugged saved mic or its return
    } catch (e) {
      useToast().add({ title: 'Could not switch device', description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
      return
    }
    if (savedMic && micBefore && !micNow)
      useToast().add({ title: 'Your microphone was unplugged', description: 'Switched to the default device.', icon: 'i-lucide-headphones', color: 'warning' })
    else if (savedMic && !micBefore && micNow)
      useToast().add({ title: `Switched back to ${savedMic.label}`, description: 'Your microphone is back.', icon: 'i-lucide-headphones', color: 'info' })
  })
  onMounted(() => v.refreshDevices())
}
