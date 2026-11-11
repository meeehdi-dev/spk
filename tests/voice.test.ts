import { describe, expect, it } from 'vitest'
import { CAMERA_CAPTURE, SCREEN_AUDIO_PUBLISH, VOICE_PUBLISH_DEFAULTS, SCREEN_AUDIO_CAPTURE, initialMute, matchDevice, sensitivityToDb, toggleDeafen, toggleMute } from '../shared/utils/voice'
import { dropVoiceOwner, joinVoice, leaveVoice, updateVoice, voiceSnapshot } from '../server/utils/voicePresence'
import { createVoiceToken } from '../server/utils/voiceToken'

describe('mute / deafen', () => {
  it('deafening also mutes; undeafening restores the earlier mute state', () => {
    let s = toggleDeafen(initialMute())
    expect(s).toMatchObject({ muted: true, deafened: true })
    expect(toggleDeafen(s)).toMatchObject({ muted: false, deafened: false })
    s = toggleDeafen(toggleMute(initialMute())) // muted, then deafened
    expect(toggleDeafen(s)).toMatchObject({ muted: true, deafened: false })
  })
  it('unmuting while deafened also undeafens', () => {
    const s = toggleMute(toggleDeafen(initialMute()))
    expect(s).toMatchObject({ muted: false, deafened: false })
  })
  it('mute toggles on its own', () => {
    expect(toggleMute(toggleMute(initialMute())).muted).toBe(false)
  })
})

describe('device matching', () => {
  const devs = [{ deviceId: 'a', label: 'Built-in' }, { deviceId: 'b', label: 'USB Mic' }]
  it('uses the saved id first', () => expect(matchDevice({ deviceId: 'b', label: 'x' }, devs)).toEqual({ deviceId: 'b', how: 'id' }))
  it('falls back to the label when the id changed', () => expect(matchDevice({ deviceId: 'zzz', label: 'USB Mic' }, devs)).toEqual({ deviceId: 'b', how: 'label' }))
  it('falls back to the default', () => {
    expect(matchDevice({ deviceId: 'zzz', label: 'Gone' }, devs)).toEqual({ how: 'default' })
    expect(matchDevice(undefined, devs)).toEqual({ how: 'default' })
  })
  it('ignores a blank label', () => expect(matchDevice({ deviceId: 'zzz', label: '' }, [{ deviceId: 'q', label: '' }])).toEqual({ how: 'default' }))
})

describe('sensitivity', () => {
  it('maps sensitivity to a threshold', () => {
    expect(sensitivityToDb(50)).toBe(-50)
    expect(sensitivityToDb(100)).toBeLessThan(sensitivityToDb(0))
  })
})

describe('voice presence', () => {
  it('replaces the middle member in place and transfers socket ownership', () => {
    const old = {}, replacement = {}, others = {}
    joinVoice('first', 'c1', 'a', others)
    joinVoice('middle', 'c1', 'old', old)
    joinVoice('last', 'c1', 'z', others)
    joinVoice('middle', 'c1', 'new', replacement)
    expect(voiceSnapshot().map(p => p.userId)).toEqual(['first', 'middle', 'last'])
    expect(leaveVoice('middle', 'old')).toBeNull()
    expect(updateVoice('middle', 'old', { muted: true })).toBeNull()
    expect(dropVoiceOwner(old)).toEqual([])
    expect(voiceSnapshot().map(p => p.userId)).toEqual(['first', 'middle', 'last'])
    expect(dropVoiceOwner(replacement)).toEqual([{ userId: 'middle', channelId: 'c1' }])
    dropVoiceOwner(others)
  })
  it('one session per account: a second join replaces the first, the old leave is ignored', () => {
    const a = {}, b = {}
    expect(joinVoice('u1', 'c1', 's1', a).replacedSid).toBeUndefined()
    expect(joinVoice('u1', 'c2', 's2', b).replacedSid).toBe('s1')
    expect(leaveVoice('u1', 's1')).toBeNull()
    expect(voiceSnapshot().filter(p => p.userId === 'u1')).toMatchObject([{ channelId: 'c2' }])
    expect(updateVoice('u1', 's1', { muted: true })).toBeNull()
    expect(leaveVoice('u1', 's2')).toEqual({ userId: 'u1', channelId: 'c2' })
  })
  it('reconnect with the same sid keeps flags; speaking clears on mute', () => {
    const a = {}
    joinVoice('u2', 'c1', 's', a)
    updateVoice('u2', 's', { deafened: true, muted: true, speaking: true })
    expect(voiceSnapshot().find(p => p.userId === 'u2')).toMatchObject({ speaking: false, muted: true })
    joinVoice('u2', 'c1', 's', {})
    expect(voiceSnapshot().find(p => p.userId === 'u2')).toMatchObject({ deafened: true })
    leaveVoice('u2', 's')
  })
  it('closing the socket clears its sessions only', () => {
    const a = {}, b = {}
    joinVoice('u3', 'c1', 's', a); joinVoice('u4', 'c1', 't', b)
    expect(dropVoiceOwner(a)).toEqual([{ userId: 'u3', channelId: 'c1' }])
    expect(voiceSnapshot().map(p => p.userId)).toEqual(['u4'])
    dropVoiceOwner(b)
  })
})

describe('voice token', () => {
  it('is a JWT for the channel room with the user as identity', async () => {
    const jwt = await createVoiceToken({ apiKey: 'devkey', apiSecret: 'secretsecretsecretsecretsecretsecret', userId: 'u1', name: 'Alex', channelId: 'room1' })
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())
    expect(claims).toMatchObject({ iss: 'devkey', sub: 'u1', name: 'Alex', video: { room: 'room1', roomJoin: true } })
  })
})

describe('screen share audio', () => {
  it('is captured without any processing', () => expect(Object.values(SCREEN_AUDIO_CAPTURE)).toEqual([false, false, false]))
})

describe('screen share and per-user volume', () => {
  it('has the Eco and Smooth screen share presets', async () => {
    const { SCREEN_SHARE_PRESETS } = await import('../shared/utils/voice')
    expect(SCREEN_SHARE_PRESETS.eco).toMatchObject({ contentHint: 'detail', degradationPreference: 'maintain-resolution', codec: 'vp9', maxBitrate: 5_000_000, resolution: { width: 2560, height: 1440, frameRate: 5 } })
    expect(SCREEN_SHARE_PRESETS.smooth).toMatchObject({ contentHint: 'motion', degradationPreference: 'maintain-framerate', codec: 'vp9', maxBitrate: 15_000_000, resolution: { width: 1920, height: 1080, frameRate: 60 } })
  })
  it('publishes single-layer, high-bitrate camera, mic and screen audio', () => {
    expect(VOICE_PUBLISH_DEFAULTS).toMatchObject({ simulcast: false, videoEncoding: { maxBitrate: 6_000_000 }, audioPreset: { maxBitrate: 128_000 }, dtx: false, red: true })
    expect(CAMERA_CAPTURE.resolution).toEqual({ width: 1920, height: 1080, frameRate: 30 })
    expect(SCREEN_AUDIO_PUBLISH).toMatchObject({ audioPreset: { maxBitrate: 256_000 }, forceStereo: true, dtx: false })
  })
  it('silences on deafen or mute-for-me, else scales by user and output volume', async () => {
    const { effectiveVolume, userVolume } = await import('../shared/utils/voice')
    const v = userVolume({ a: { screen: 0.5 } }, 'a')
    expect(v).toEqual({ mic: 1, screen: 0.5, muted: false })
    expect(effectiveVolume(false, v, 'screen', 0.5)).toBe(0.25)
    expect(effectiveVolume(true, v, 'mic', 1)).toBe(0)
    expect(effectiveVolume(false, { ...v, muted: true }, 'mic', 1)).toBe(0)
  })
})

describe('voice cam/screen flags', () => {
  it('update and survive a same-sid reconnect', () => {
    joinVoice('u5', 'c1', 's', {})
    updateVoice('u5', 's', { cam: true, screen: true })
    joinVoice('u5', 'c1', 's', {})
    expect(voiceSnapshot().find(p => p.userId === 'u5')).toMatchObject({ cam: true, screen: true })
    updateVoice('u5', 's', { screen: false })
    expect(voiceSnapshot().find(p => p.userId === 'u5')).toMatchObject({ cam: true, screen: false })
    leaveVoice('u5', 's')
  })
})
