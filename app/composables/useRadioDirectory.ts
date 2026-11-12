import type { RadioSummary } from '#shared/utils/radio'

export const useRadioDirectory = () => useState<Record<string, NonNullable<RadioSummary['station']>>>('radio-directory', () => ({}))

/** Layout lifetime: keep receiving status while the mobile sidebar is closed. */
export function useRadioDirectoryLive() {
  if (!import.meta.client) return
  const stations = useRadioDirectory()
  const socket = useSocket()
  const clear = () => {
    stations.value = {}
  }
  clear()
  socket.on(m => {
    if (!socket.connected.value) return
    if (m.type === 'radio:snapshot') {
      stations.value = Object.fromEntries(m.channels.filter(c => c.station).map(c => [c.channelId, c.station!]))
    } else if (m.type === 'radio:update') {
      if (m.station) stations.value = { ...stations.value, [m.channelId]: m.station }
      else {
        stations.value = Object.fromEntries(Object.entries(stations.value).filter(([id]) => id !== m.channelId))
      }
    }
  })
  watch(
    socket.connected,
    connected => {
      if (!connected) clear()
    },
    { flush: 'sync' },
  )
  onScopeDispose(clear)
}
