import type { ManualStatus, Presence } from '#shared/utils/presence'

const status = ref<Record<string, Presence>>({})
const COLOR = { online: 'success', idle: 'warning', busy: 'error', offline: 'neutral' } as const
const LABEL = { online: 'Online', idle: 'Away', busy: 'Busy', offline: 'Offline' } as const

export const presenceLabel = (p: Presence) => LABEL[p]

/** This browser's chosen status, re-sent to the server on every socket open. */
export const useMyStatus = () => useLocalStorage<ManualStatus>('spk:status', 'online')

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
  const myStatus = useMyStatus()
  const sendStatus = () => socket.send({ type: 'presence:set', status: myStatus.value })
  watch(myStatus, sendStatus)
  const { idle } = useIdle(10 * 60_000)
  const visibility = useDocumentVisibility()
  const away = computed(() => idle.value || visibility.value === 'hidden')
  const report = () => socket.send({ type: away.value ? 'presence:idle' : 'presence:active' })
  socket.onOpen(() => {
    void load()
    sendStatus()
    report()
  })
  watch(away, report)
  onMounted(load)
}
