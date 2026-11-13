import { describe, expect, it } from 'vitest'

import {
  dropVoiceOwner,
  joinVoice,
  leaveVoice,
  readyVoice,
  sessionOf,
  sessionsIn,
  soundAudience,
  updateVoice,
  voiceSnapshot,
} from '~~/server/utils/voicePresence'

describe('voice presence', () => {
  it('hides a session until ready; state is stored silently; a never-ready leave is not announced', () => {
    const o = {}
    joinVoice('h1', 'c1', 's', o, false)
    expect(voiceSnapshot().some(p => p.userId === 'h1')).toBe(false)
    expect(updateVoice('h1', 's', { muted: true })).toBeNull()
    expect(readyVoice('h1', 'other')).toBeNull()
    expect(readyVoice('h1', 's')).toMatchObject({ userId: 'h1', channelId: 'c1', muted: true })
    expect(readyVoice('h1', 's')).toBeNull()
    expect(voiceSnapshot().some(p => p.userId === 'h1')).toBe(true)
    leaveVoice('h1', 's')
    joinVoice('h2', 'c1', 's', o, false)
    expect(leaveVoice('h2', 's')).toMatchObject({ ready: false })
    joinVoice('h3', 'c1', 's', o, false)
    expect(dropVoiceOwner(o)).toEqual([])
  })
  it('a same-channel takeover of a visible session stays visible; another channel hides', () => {
    joinVoice('h4', 'c1', 'a', {})
    expect(joinVoice('h4', 'c1', 'b', {}, false)).toMatchObject({ visible: true, replacedVisible: true })
    expect(joinVoice('h4', 'c2', 'c', {}, false)).toMatchObject({ visible: false, replacedVisible: true })
    expect(voiceSnapshot().some(p => p.userId === 'h4')).toBe(false)
    leaveVoice('h4', 'c')
  })
  it('replaces the middle member in place and transfers socket ownership', () => {
    const old = {},
      replacement = {},
      others = {}
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
    const a = {},
      b = {}
    expect(joinVoice('u1', 'c1', 's1', a).replacedSid).toBeUndefined()
    expect(joinVoice('u1', 'c2', 's2', b).replacedSid).toBe('s1')
    expect(leaveVoice('u1', 's1')).toBeNull()
    expect(voiceSnapshot().filter(p => p.userId === 'u1')).toMatchObject([{ channelId: 'c2' }])
    expect(updateVoice('u1', 's1', { muted: true })).toBeNull()
    expect(leaveVoice('u1', 's2')).toEqual({ userId: 'u1', channelId: 'c2', ready: true })
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
    const a = {},
      b = {}
    joinVoice('u3', 'c1', 's', a)
    joinVoice('u4', 'c1', 't', b)
    expect(dropVoiceOwner(a)).toEqual([{ userId: 'u3', channelId: 'c1' }])
    expect(voiceSnapshot().map(p => p.userId)).toEqual(['u4'])
    dropVoiceOwner(b)
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

describe('voice watching', () => {
  it('validates the array, caps it and resets on a new session', () => {
    joinVoice('u6', 'c1', 's', {})
    updateVoice('u6', 's', { watching: ['a', 1, 'b'] })
    expect(voiceSnapshot().find(p => p.userId === 'u6')?.watching).toEqual(['a', 'b'])
    updateVoice('u6', 's', { watching: Array.from({ length: 200 }, (_, i) => String(i)) })
    expect(voiceSnapshot().find(p => p.userId === 'u6')?.watching).toHaveLength(50)
    updateVoice('u6', 's', { watching: ['x'.repeat(65), 'ok'] })
    expect(voiceSnapshot().find(p => p.userId === 'u6')?.watching).toEqual(['ok'])
    updateVoice('u6', 's', { watching: Array.from({ length: 200 }, (_, i) => String(i)) })
    updateVoice('u6', 's', { watching: 'nope' })
    expect(voiceSnapshot().find(p => p.userId === 'u6')?.watching).toHaveLength(50)
    joinVoice('u6', 'c1', 's2', {})
    expect(voiceSnapshot().find(p => p.userId === 'u6')?.watching).toEqual([])
    leaveVoice('u6', 's2')
  })
})

describe('session lookups for admin actions', () => {
  it('finds a user’s session and a channel’s members', () => {
    const o = {}
    joinVoice('b', 'v1', 'sid-b', o)
    joinVoice('a', 'v1', 'sid-a', o)
    joinVoice('c', 'v2', 'sid-c', o)
    expect(sessionOf('b')).toEqual({ sid: 'sid-b', channelId: 'v1' })
    expect(
      sessionsIn('v1')
        .map(s => s.userId)
        .sort(),
    ).toEqual(['a', 'b'])
    dropVoiceOwner(o)
    expect(sessionOf('b')).toBeNull()
  })
})

describe('soundAudience', () => {
  it('is the channel of the current session only', () => {
    joinVoice('s1', 'ch', 'x', {})
    joinVoice('s2', 'ch', 'y', {})
    joinVoice('s3', 'other', 'z', {})
    expect(soundAudience('s1', 'x')?.sort()).toEqual(['s1', 's2'])
    expect(soundAudience('s1', 'stale')).toBeNull()
    expect(soundAudience('nobody', 'x')).toBeNull()
    for (const [u, s] of [
      ['s1', 'x'],
      ['s2', 'y'],
      ['s3', 'z'],
    ] as const)
      leaveVoice(u, s)
    expect(soundAudience('s1', 'x')).toBeNull()
  })
})
