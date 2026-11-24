export interface UserEntry {
  id: string
  displayName: string | null
  avatarKey: string | null
  role: string
  banned?: boolean
}
export interface ChannelEntry {
  id: string
  type: 'text' | 'voice' | 'dm' | 'webhook'
  name: string | null
  otherUserId?: string
  lastActivityAt?: number | null
  icon?: string
  ownerId?: string
  private?: boolean
}

const headers = () => useRequestHeaders(['cookie'])

export const useChannels = () => useFetch<ChannelEntry[]>('/api/channels', { key: 'channels', headers: headers(), default: () => [] })

/** Everyone's current nickname, so mentions and authors follow renames. */
export function useUsers() {
  const res = useFetch<UserEntry[]>('/api/users', { key: 'users', headers: headers(), default: () => [] })
  const byId = computed(() => new Map(res.data.value.map(u => [u.id, u])))
  return { ...res, byId, nameOf: (id: string) => byId.value.get(id)?.displayName || 'Unknown user' }
}

/** "#general" for text channels, "@Alex" for a DM, the bare name for a webhook. */
export function useChannelLabel() {
  const { nameOf } = useUsers()
  return (c?: ChannelEntry) => (!c ? '' : c.type === 'dm' ? `@${nameOf(c.otherUserId ?? '')}` : c.type === 'webhook' ? (c.name ?? '') : `#${c.name}`)
}

export const avatarSrc = (u?: { id: string; avatarKey: string | null }) => (u?.avatarKey ? `/api/avatar/${u.id}?v=${u.avatarKey}` : undefined)
