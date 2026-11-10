import { allowedBy, notificationBody, type NotifyPrefs } from '#shared/utils/notifyText'
import { extractMentionIds } from '#shared/utils/markdown'

export interface NotifySettings extends Required<NotifyPrefs> { sound: boolean, volume: number }

export const useNotifySettings = () =>
  useLocalStorage<NotifySettings>('spk:notify', { dms: true, pings: true, dnd: false, sound: true, volume: 0.5, muted: [] }, { mergeDefaults: true })

/** Per-channel mute (stored in the notification settings, so Web Push honours it too). */
export function useMute() {
  const s = useNotifySettings()
  return {
    isMuted: (id: string) => s.value.muted.includes(id),
    toggle: (id: string) => { s.value = { ...s.value, muted: s.value.muted.includes(id) ? s.value.muted.filter(x => x !== id) : [...s.value.muted, id] } }
  }
}

let audio: AudioContext | undefined
/** A short two-note blip, synthesized so no sound file is needed. */
export function playBlip(volume: number) {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    for (const [i, f] of [660, 880].entries()) {
      const o = audio.createOscillator(), g = audio.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.3 * volume, t + i * 0.09)
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.12)
      o.connect(g).connect(audio.destination)
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.13)
    }
  } catch { /* autoplay policy: stay silent */ }
}

const notificationsSupported = () => import.meta.client && 'Notification' in window

/** Browser permission as a ref; `ask` must be called from a button click. */
export function useNotificationPermission() {
  const permission = ref<NotificationPermission | 'unsupported'>(notificationsSupported() ? Notification.permission : 'unsupported')
  return {
    permission,
    ask: async () => { if (notificationsSupported()) permission.value = await Notification.requestPermission() }
  }
}

/**
 * One place that decides toast, system notification or both. Callers pass what happened;
 * `target` is the app URL to open.
 */
export function useNotify() {
  const toast = useToast()
  const s = useNotifySettings()
  return {
    toast: (o: { title: string, description?: string, icon?: string, color?: 'error' | 'success' | 'info' | 'warning' | 'neutral' }) => toast.add({ icon: 'i-lucide-info', ...o }),
    /** `focusedHere`: this window is focused (toast, no system notification). */
    message(o: { title: string, body: string, target: string, tag: string, focused: boolean }) {
      if (s.value.sound) playBlip(s.value.volume)
      if (o.focused) {
        toast.add({ title: o.title, description: o.body, icon: 'i-lucide-message-circle', actions: [{ label: 'Open', icon: 'i-lucide-arrow-right', onClick: () => navigateTo(o.target) }] })
      } else if (notificationsSupported() && Notification.permission === 'granted') {
        const n = new Notification(o.title, { body: o.body, tag: o.tag, icon: '/icons/icon-192.png' })
        n.onclick = () => { window.focus(); navigateTo(o.target); n.close() }
      }
    }
  }
}

/** Layout only: turns live `message:new` frames for DMs, pings and replies into notifications. One tab notifies. */
export function useIncomingNotifications() {
  if (!import.meta.client) return
  const socket = useSocket()
  const { data: me } = useMe()
  const { data: channels } = useChannels()
  const { nameOf } = useUsers()
  const settings = useNotifySettings()
  const notify = useNotify()
  const route = useRoute()
  const bc = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('spk-notify')
  const claims = new Map<string, number[]>()
  bc?.addEventListener('message', (e) => { claims.get(e.data.id)?.push(e.data.rank) })
  onScopeDispose(() => bc?.close())

  // The focused tab wins (rank 0), otherwise the lowest random rank. A focused tab on that channel then stays silent, so nobody notifies.
  async function iAmTheOne(id: string) {
    const rank = document.hasFocus() ? 0 : 1 + Math.random()
    if (!bc) return true
    claims.set(id, [rank])
    bc.postMessage({ id, rank })
    await new Promise(r => setTimeout(r, 150))
    const all = claims.get(id)!
    claims.delete(id)
    return rank <= Math.min(...all)
  }

  socket.on(async (m) => {
    if (m.type !== 'message:new' || !me.value || m.message.userId === me.value.id) return
    const msg = m.message
    const ch = channels.value.find(c => c.id === msg.channelId)
    if (!ch) return
    const isDm = ch.type === 'dm'
    const pinged = extractMentionIds(msg.body).includes(me.value.id) || msg.replyTo?.userId === me.value.id
    if ((!isDm && !pinged) || !allowedBy(settings.value, ch.id, isDm)) return
    if (!(await iAmTheOne(msg.id))) return
    const focused = document.hasFocus()
    if (focused && route.params.channelId === ch.id) return
    const author = nameOf(msg.userId)
    notify.message({
      title: isDm ? author : `${author} in #${ch.name}`,
      body: notificationBody(msg.body, nameOf) || (msg.attachments.length ? 'Sent an attachment' : ''),
      target: `/c/${ch.id}/m/${msg.id}`, tag: ch.id, focused
    })
  })
}
