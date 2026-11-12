// @vitest-environment happy-dom
import type { MessageDto } from '../server/db/messages'

import { readFileSync } from 'node:fs'

import { transpile } from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { parse } from 'vue/compiler-sfc'

const me = ref<{ id: string } | null>({ id: 'a' })

beforeEach(() => {
  localStorage.clear()
  me.value = { id: 'a' }
  vi.resetModules()
  vi.stubGlobal('useMe', () => ({ data: me }))
})
afterEach(() => vi.unstubAllGlobals())

describe('recent reactions', () => {
  it('shares three deduplicated recent/default buttons, promotes reuse and evicts the oldest', async () => {
    const { useRecentReactions } = await import('../app/composables/useRecentReactions')
    const first = useRecentReactions()
    const otherChannel = useRecentReactions()
    expect(first.quickReactions.value).toEqual(['👍', '❤️', '😂'])
    first.record('❤️', 'a')
    expect(otherChannel.quickReactions.value).toEqual(['❤️', '👍', '😂'])
    for (const emoji of ['🎉', '🔥', '🎉', '👀']) first.record(emoji, 'a')
    expect(first.quickReactions.value).toEqual(['👀', '🎉', '🔥'])
    await nextTick()
    expect(JSON.parse(localStorage.getItem('spk:recent-reactions:a')!)).toEqual(['👀', '🎉', '🔥'])
  })

  it('persists across a fresh module and isolates switched or unavailable accounts', async () => {
    const { useRecentReactions } = await import('../app/composables/useRecentReactions')
    const reactions = useRecentReactions()
    reactions.record('🎉', 'a')
    await nextTick()
    vi.resetModules()
    const reloaded = (await import('../app/composables/useRecentReactions')).useRecentReactions()
    expect(reloaded.quickReactions.value).toEqual(['🎉', '👍', '❤️'])
    me.value = { id: 'b' }
    expect(reloaded.quickReactions.value).toEqual(['👍', '❤️', '😂'])
    reloaded.record('🔥', 'b')
    await nextTick()
    me.value = null
    expect(reloaded.quickReactions.value).toEqual(['👍', '❤️', '😂'])
    reloaded.record('👀', undefined)
    expect(localStorage.length).toBe(2)
    me.value = { id: 'a' }
    expect(reloaded.quickReactions.value).toEqual(['🎉', '👍', '❤️'])
    me.value = { id: 'b' }
    expect(reloaded.quickReactions.value).toEqual(['🔥', '👍', '❤️'])
  })

  it('records only successful API additions and retains the initiating account during a pending response', async () => {
    const { useRecentReactions } = await import('../app/composables/useRecentReactions')
    const { record, quickReactions } = useRecentReactions()
    // Exercise the actual provided handler without mounting unrelated channel/scroll services.
    const { descriptor } = parse(readFileSync('app/components/chat/ChannelView.vue', 'utf8'))
    const script = descriptor.scriptSetup!.content
    const handler = script.slice(script.indexOf('  async react('), script.indexOf('  reply(id)'))
    const setup = new Function('$fetch', 'me', 'recordReaction', 'byIdMsg', 'apiError', transpile(`return { ${handler} }`))
    const fetch = vi.fn<() => Promise<{ reactions: MessageDto['reactions'] }>>()
    const message = { reactions: [] as MessageDto['reactions'] }
    const apiError = vi.fn()
    const actions = setup(fetch, me, record, () => message, apiError) as { react: (id: string, emoji: string, on: boolean) => Promise<void> }

    fetch.mockResolvedValue({ reactions: [{ emoji: '🎉', userIds: ['a'] }] })
    await actions.react('m', '🎉', true)
    expect(quickReactions.value).toEqual(['🎉', '👍', '❤️'])
    expect(message.reactions).toEqual([{ emoji: '🎉', userIds: ['a'] }])
    await actions.react('m', '🎉', false)
    fetch.mockRejectedValueOnce(new Error('offline'))
    await actions.react('m', '🔥', true)
    expect(apiError).toHaveBeenCalledWith(expect.any(Error), 'Could not react')
    expect(quickReactions.value).toEqual(['🎉', '👍', '❤️'])

    const response = Promise.withResolvers<{ reactions: MessageDto['reactions'] }>()
    fetch.mockReturnValueOnce(response.promise)
    const pending = actions.react('m', '👀', true)
    me.value = { id: 'b' }
    response.resolve({ reactions: [] })
    await pending
    expect(quickReactions.value).toEqual(['👍', '❤️', '😂'])
    expect(localStorage.getItem('spk:recent-reactions:b')).toBeNull()
    me.value = { id: 'a' }
    expect(quickReactions.value).toEqual(['👀', '🎉', '👍'])
  })
})
