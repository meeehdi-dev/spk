import type { Presence } from '#shared/utils/presence'

const status = ref<Record<string, Presence>>({})
const COLOR = { online: 'success', idle: 'warning', offline: 'neutral' } as const

export const presenceOf = (id: string): Presence => status.value[id] ?? 'offline'
/** `chip` prop for a UAvatar: the presence dot. */
export const presenceChip = (id: string) => ({ color: COLOR[presenceOf(id)], inset: true, ring: false })

/** Layout only: loads who's online, follows updates, and reports this tab as idle after 10 min without input or while hidden. */
export function usePresenceLive() {
  if (!import.meta.client) return
  const socket = useSocket()
  const load = () =>
    $fetch<Record<string, Presence>>('/api/users/presence')
      .then(r => {
        status.value = r
      })
      .catch(() => {})
  socket.on(m => {
    if (m.type !== 'presence:update') return
    const next = { ...status.value }
    if (m.status === 'offline') Reflect.deleteProperty(next, m.userId)
    else next[m.userId] = m.status
    status.value = next
  })
  const { idle } = useIdle(10 * 60_000)
  const visibility = useDocumentVisibility()
  const away = computed(() => idle.value || visibility.value === 'hidden')
  const report = () => socket.send({ type: away.value ? 'presence:idle' : 'presence:active' })
  socket.onOpen(() => {
    void load()
    report()
  })
  watch(away, report)
  onMounted(load)
}
