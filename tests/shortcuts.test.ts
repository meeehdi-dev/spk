import { describe, expect, it } from 'vitest'
import { SHORTCUT_GROUPS, stepChannel, stepUnread } from '../shared/utils/shortcuts'

describe('channel stepping', () => {
  const ids = ['a', 'b', 'c']
  it('moves and wraps', () => {
    expect(stepChannel(ids, 'a', 1)).toBe('b')
    expect(stepChannel(ids, 'c', 1)).toBe('a')
    expect(stepChannel(ids, 'a', -1)).toBe('c')
  })
  it('starts at an end when not in a channel', () => {
    expect(stepChannel(ids, undefined, 1)).toBe('a')
    expect(stepChannel(ids, undefined, -1)).toBe('c')
    expect(stepChannel([], 'a', 1)).toBeUndefined()
  })
  it('finds the next unread, skipping read ones and the current', () => {
    const unread = (id: string) => id === 'a' || id === 'c'
    expect(stepUnread(ids, 'a', 1, unread)).toBe('c')
    expect(stepUnread(ids, 'c', 1, unread)).toBe('a')
    expect(stepUnread(ids, 'b', -1, unread)).toBe('a')
    expect(stepUnread(ids, undefined, 1, unread)).toBe('a')
    expect(stepUnread(ids, undefined, -1, unread)).toBe('c')
    expect(stepUnread(ids, 'a', 1, id => id === 'a')).toBeUndefined()
  })
})

describe('shortcut list', () => {
  it('has no duplicate wired key combination inside a group', () => {
    for (const g of SHORTCUT_GROUPS) {
      const seen = g.items.filter(i => !i.planned).map(i => i.keys.join('+'))
      expect(new Set(seen).size).toBe(seen.length)
    }
  })
})
