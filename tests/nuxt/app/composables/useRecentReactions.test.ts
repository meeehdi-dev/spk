import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useRecentReactions } from '~/composables/useRecentReactions'

const me = await vi.hoisted(async () => (await import('vue')).ref<{ id: string } | null>(null))
mockNuxtImport('useMe', () => () => ({ data: me }))

beforeEach(() => localStorage.clear())

describe('recent reactions', () => {
  it('shares three deduplicated recent/default buttons, promotes reuse and evicts the oldest', async () => {
    me.value = { id: 'shared' }
    const first = useRecentReactions()
    const otherChannel = useRecentReactions()
    expect(first.quickReactions.value).toEqual(['👍', '❤️', '😂'])
    first.record('❤️', 'shared')
    expect(otherChannel.quickReactions.value).toEqual(['❤️', '👍', '😂'])
    for (const emoji of ['🎉', '🔥', '🎉', '👀']) first.record(emoji, 'shared')
    expect(first.quickReactions.value).toEqual(['👀', '🎉', '🔥'])
    await nextTick()
    expect(JSON.parse(localStorage.getItem('spk:recent-reactions:shared')!)).toEqual(['👀', '🎉', '🔥'])
  })

  it('restores saved history and isolates switched or unavailable accounts', async () => {
    localStorage.setItem('spk:recent-reactions:saved', JSON.stringify(['🎉']))
    me.value = { id: 'saved' }
    const reactions = useRecentReactions()
    expect(reactions.quickReactions.value).toEqual(['🎉', '👍', '❤️'])
    me.value = { id: 'other' }
    expect(reactions.quickReactions.value).toEqual(['👍', '❤️', '😂'])
    reactions.record('🔥', 'other')
    await nextTick()
    me.value = null
    expect(reactions.quickReactions.value).toEqual(['👍', '❤️', '😂'])
    reactions.record('👀', undefined)
    expect(localStorage.length).toBe(2)
    me.value = { id: 'saved' }
    expect(reactions.quickReactions.value).toEqual(['🎉', '👍', '❤️'])
    me.value = { id: 'other' }
    expect(reactions.quickReactions.value).toEqual(['🔥', '👍', '❤️'])
  })
})
