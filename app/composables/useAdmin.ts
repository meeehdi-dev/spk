import type { ChannelEntry } from '~/composables/useUsers'

type AdminDialog =
  | { kind: 'create'; type: 'text' | 'voice' }
  | { kind: 'rename' | 'delete'; channel: ChannelEntry }
  | { kind: 'ban'; userId: string }
  | { kind: 'profile'; userId: string }

const dialog = ref<AdminDialog | null>(null)
/** The message input watches this to insert `<@id>`. */
const mentionRequest = ref<{ id: string; n: number } | null>(null)

const fail = (title: string) => (error: unknown) => {
  const e = error as { statusMessage?: string; message?: string } | null
  return useToast().add({ title, description: e?.statusMessage ?? e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
}

/** Keeps channels, the user directory and our session current when an admin changes them (or bans us). Layout only. */
export function useAdminLive() {
  const socket = useSocket()
  socket.on(m => {
    if (m.type === 'channels:changed') void refreshNuxtData('channels')
    else if (m.type === 'users:changed') void refreshNuxtData(['users', 'me'])
    else if (m.type === 'banned') window.location.assign('/login') // the sessions are gone; a reload also stops the socket's reconnects
  })
  const { data: channels } = useChannels()
  const route = useRoute()
  // The channel being viewed was deleted.
  watch(channels, list => {
    const id = route.params.channelId
    if (route.path.startsWith('/c/') && id && list.length && !list.some(c => c.id === id)) {
      useToast().add({ title: 'That channel no longer exists', color: 'warning', icon: 'i-lucide-info' })
      void navigateTo('/')
    }
  })
}

export function useAdmin() {
  const { data: me } = useMe()
  const { data: channels } = useChannels()
  const { byId, nameOf } = useUsers()
  const route = useRoute()
  const voice = useVoice()
  const isAdmin = computed(() => me.value?.role === 'admin')
  const origin = () => window.location.origin

  const refreshChannels = () => refreshNuxtData('channels')
  async function reorder(type: 'text' | 'voice', ids: string[]) {
    try {
      await $fetch('/api/admin/channels/order', { method: 'POST', body: { type, ids } })
    } catch (e) {
      fail('Could not reorder')(e)
    }
    await refreshChannels()
  }
  const section = (type: string) => channels.value.filter(c => c.type === type)
  const step = (c: ChannelEntry, d: -1 | 1) => {
    const ids = section(c.type).map(x => x.id),
      i = ids.indexOf(c.id),
      j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    void reorder(c.type as 'text' | 'voice', ids)
  }

  /** Channel menu entries (flat). Admin entries only when the signed-in user is admin; the server checks again. */
  function channelItems(c: ChannelEntry) {
    if (!isAdmin.value) return []
    const ids = section(c.type).map(x => x.id),
      i = ids.indexOf(c.id)
    return [
      {
        label: 'Rename',
        icon: 'i-lucide-pencil',
        onSelect: () => {
          dialog.value = { kind: 'rename', channel: c }
        },
      },
      { label: 'Move up', icon: 'i-lucide-arrow-up', disabled: i <= 0, onSelect: () => step(c, -1) },
      { label: 'Move down', icon: 'i-lucide-arrow-down', disabled: i < 0 || i >= ids.length - 1, onSelect: () => step(c, 1) },
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => {
          dialog.value = { kind: 'delete', channel: c }
        },
      },
    ]
  }

  async function post(url: string, body: Record<string, unknown>, title: string, ok?: string) {
    try {
      await $fetch(url, { method: 'POST', body })
      if (ok) useToast().add({ title: ok, icon: 'i-lucide-check' })
      return true
    } catch (e) {
      fail(title)(e)
      return false
    }
  }
  const setRole = (id: string, role: 'admin' | 'user') =>
    post(`/api/admin/users/${id}/role`, { role }, 'Could not change the role', `${nameOf(id)} is now ${role === 'admin' ? 'an admin' : 'a user'}`)
  const setBanned = (id: string, banned: boolean, reason?: string) =>
    post(
      `/api/admin/users/${id}/ban`,
      { banned, reason },
      banned ? 'Could not ban' : 'Could not unban',
      banned ? `${nameOf(id)} was banned` : `${nameOf(id)} was unbanned`,
    )
  const disconnect = (id: string) => post('/api/admin/voice/disconnect', { userId: id }, 'Could not disconnect', `${nameOf(id)} was disconnected`)
  const move = (id: string, channelId: string) => post('/api/admin/voice/move', { userId: id, channelId }, 'Could not move', `${nameOf(id)} was moved`)

  /** Menu groups for a person: profile, DM, mention, copy name, volumes, then admin actions. */
  function userGroups(id: string) {
    const mine = me.value?.id === id
    const cur = channels.value.find(c => c.id === route.params.channelId)
    const inChat = route.path.startsWith('/c/') && (cur?.type === 'text' || cur?.type === 'dm')
    const groups: Array<Array<Record<string, unknown>>> = [
      [
        {
          label: 'Profile',
          icon: 'i-lucide-user',
          onSelect: () => {
            dialog.value = { kind: 'profile', userId: id }
          },
        },
        ...(mine ? [] : [{ label: 'Send DM', icon: 'i-lucide-message-circle', onSelect: () => openDmWith(id) }]),
        ...(inChat
          ? [
              {
                label: 'Mention',
                icon: 'i-lucide-at-sign',
                onSelect: () => {
                  mentionRequest.value = { id, n: Date.now() }
                },
              },
            ]
          : []),
        { label: 'Copy name', icon: 'i-lucide-copy', onSelect: () => copyText(nameOf(id)) },
      ],
      voice.volumeItems(id),
    ]
    if (isAdmin.value) {
      const at = voiceChannelOf(id)
      const target = byId.value.get(id)
      const others = channels.value
        .filter(c => c.type === 'voice' && c.id !== at)
        .map(c => ({ label: c.name ?? '', icon: 'i-lucide-volume-2', onSelect: () => move(id, c.id) }))
      groups.push([
        {
          label: 'Change role',
          icon: 'i-lucide-shield',
          children: [
            { label: 'Admin', icon: 'i-lucide-shield-check', type: 'checkbox', checked: target?.role === 'admin', onSelect: () => setRole(id, 'admin') },
            { label: 'User', icon: 'i-lucide-user', type: 'checkbox', checked: target?.role !== 'admin', onSelect: () => setRole(id, 'user') },
          ],
        },
        ...(at
          ? [
              ...(others.length ? [{ label: 'Move to', icon: 'i-lucide-move-right', children: others }] : []),
              { label: 'Disconnect from voice', icon: 'i-lucide-phone-off', onSelect: () => disconnect(id) },
            ]
          : []),
        ...(mine
          ? []
          : [
              target?.banned
                ? { label: 'Unban', icon: 'i-lucide-user-check', onSelect: () => setBanned(id, false) }
                : {
                    label: 'Ban',
                    icon: 'i-lucide-ban',
                    color: 'error' as const,
                    onSelect: () => {
                      dialog.value = { kind: 'ban', userId: id }
                    },
                  },
            ]),
      ])
    }
    return groups.filter(g => g.length)
  }

  return { isAdmin, dialog, mentionRequest, channelItems, userGroups, setRole, setBanned, disconnect, move, reorder, origin, fail }
}
