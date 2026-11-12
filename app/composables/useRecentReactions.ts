import { useLocalStorage } from '@vueuse/core'
import { computed, effectScope } from 'vue'

import { QUICK_REACTIONS } from '../utils/emoji'

const histories = new Map<string, ReturnType<typeof createHistory>>()
const createHistory = (id: string) => effectScope(true).run(() => useLocalStorage<string[]>(`spk:recent-reactions:${id}`, [], { writeDefaults: false }))!

function historyFor(id: string) {
  if (!histories.has(id)) histories.set(id, createHistory(id))
  return histories.get(id)!
}

export function useRecentReactions() {
  const { data: me } = useMe()
  const quickReactions = computed(() => {
    const recent = import.meta.client && me.value?.id ? historyFor(me.value.id).value : []
    return [...new Set([...recent, ...QUICK_REACTIONS])].slice(0, 3)
  })

  function record(emoji: string, accountId: string | undefined) {
    if (!import.meta.client || !accountId) return
    const history = historyFor(accountId)
    history.value = [...new Set([emoji, ...history.value])].slice(0, 3)
  }

  return { quickReactions, record }
}
