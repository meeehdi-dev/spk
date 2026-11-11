export interface UnreadState {
  unread: number
  mentions: number
}

/** Unread and mention counts per channel, kept live by the server's `unread:update` frames. Call once in the layout. */
export function useUnread() {
  const counts = useState<Record<string, UnreadState>>('unread', () => ({}))
  const refresh = () =>
    $fetch<Record<string, UnreadState>>('/api/unread')
      .then(r => {
        counts.value = r
      })
      .catch(() => {})
  return {
    counts,
    refresh,
    set: (id: string, s: UnreadState) => {
      counts.value = { ...counts.value, [id]: s }
    },
    of: (id: string): UnreadState => counts.value[id] ?? { unread: 0, mentions: 0 },
  }
}

/** Layout only: load the counts, follow live updates, refresh the DM list when a DM we don't know yet speaks. */
export function useUnreadLive() {
  const u = useUnread()
  const socket = useSocket()
  const { data: channels, refresh: refreshChannels } = useChannels()
  onMounted(() => {
    void u.refresh()
  })
  socket.onOpen(u.refresh)
  socket.on(m => {
    if (m.type === 'unread:update') u.set(m.channelId, { unread: m.unread, mentions: m.mentions })
    else if (m.type === 'message:new') {
      const c = channels.value.find(x => x.id === m.message.channelId)
      if (!c || c.type === 'dm') void refreshChannels()
    }
  })
}

/** Marks a channel read on the server; the server echoes the new counts to all our tabs. */
export const markChannelRead = (channelId: string) =>
  $fetch<UnreadState>(`/api/channels/${channelId}/read`, { method: 'POST' })
    .then(s => useUnread().set(channelId, s))
    .catch(() => {})

/** Opens (creating if needed) the DM with a user and goes there. */
export async function openDmWith(userId: string) {
  try {
    const dm = await $fetch<{ id: string }>('/api/dms', { method: 'POST', body: { userId } })
    await refreshNuxtData('channels')
    await navigateTo(`/c/${dm.id}`)
  } catch (e) {
    useToast().add({ title: errorText(e, 'Could not open the DM'), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

/** DMs the user hid; one comes back when it has activity newer than when it was hidden. */
export function useHiddenDms() {
  const hidden = useLocalStorage<Record<string, number>>('spk:hidden-dms', {})
  return {
    isHidden: (c: ChannelEntry) => c.id in hidden.value && (c.lastActivityAt ?? 0) <= hidden.value[c.id]!,
    hide: (c: ChannelEntry) => {
      hidden.value = { ...hidden.value, [c.id]: c.lastActivityAt ?? Date.now() }
    },
  }
}

/** The channels the sidebar shows, in its order (visible DMs, text channels, voice channels). Shared by the sidebar, Alt ↑/↓ and the quick switcher. */
export function useNavChannels() {
  const { data: channels } = useChannels()
  const route = useRoute()
  const { isHidden } = useHiddenDms()
  const dms = computed(() =>
    channels.value.filter(c => c.type === 'dm' && (c.lastActivityAt || route.params.channelId === c.id) && (!isHidden(c) || route.params.channelId === c.id)),
  )
  const textChannels = computed(() => channels.value.filter(c => c.type === 'text'))
  const voiceChannels = computed(() => channels.value.filter(c => c.type === 'voice'))
  return { dms, textChannels, voiceChannels, all: computed(() => [...dms.value, ...textChannels.value, ...voiceChannels.value]) }
}
