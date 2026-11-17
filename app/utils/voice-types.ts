import type { ScreenQuality } from '#shared/utils/voice'

/** A media provider owns playback; the view only attaches and detaches its video element. */
export interface VoiceVideoTrack {
  attach(element: HTMLMediaElement): unknown
  detach(element: HTMLMediaElement): unknown
}

export interface VoiceMember {
  channelId: string
  muted: boolean
  deafened: boolean
  speaking: boolean
  cam: boolean
  screen: boolean
  radioListening: boolean
  watching: string[]
}

/** One tile per person. Tracks are present only for local video or watched remote video. */
export interface VoiceTile {
  userId: string
  local: boolean
  speaking: boolean
  camLive: boolean
  screenLive: boolean
  screenQuality?: ScreenQuality
  screenAudio: boolean
  watching: boolean
  cam?: VoiceVideoTrack
  screen?: VoiceVideoTrack
}
