import type { SocketFrame } from './useSocket'

import { effectScope, ref, watch } from 'vue'

import { useUploads } from './useUploads'

interface Reply {
  id: string
  name: string
  preview: string
}
export interface OutgoingDraft {
  text: string
  gif: string | null
  reply: Reply | null
  files: Upload[]
}

function createDraft(channelId: string) {
  const key = `spk:draft:${channelId}`
  const text = ref(import.meta.client ? (localStorage.getItem(key) ?? '') : '')
  if (import.meta.client)
    effectScope(true).run(() => {
      watch(text, v => (v ? localStorage.setItem(key, v) : localStorage.removeItem(key)), { flush: 'sync' })
    })
  return { text, gif: ref<string | null>(null), reply: ref<Reply | null>(null), uploads: useUploads() }
}

const drafts = new Map<string, ReturnType<typeof createDraft>>()
const pending = new Map<string, { channelId: string; draft: OutgoingDraft }>()

/** Browser-only draft contents and running uploads, independent of the visible channel. */
export function useDrafts() {
  const toast = useToast()
  function get(channelId: string) {
    if (!import.meta.client) return createDraft(channelId)
    if (!drafts.has(channelId)) drafts.set(channelId, createDraft(channelId))
    return drafts.get(channelId)!
  }

  function take(channelId: string): OutgoingDraft {
    const d = get(channelId)
    const sent = {
      text: d.text.value,
      gif: d.gif.value,
      reply: d.reply.value,
      files: d.uploads.ready.value.map(f => ({ ...f, xhr: undefined, preview: undefined })),
    }
    d.text.value = ''
    d.gif.value = null
    d.reply.value = null
    d.uploads.clear()
    return sent
  }

  function restore(channelId: string, sent: OutgoingDraft) {
    const d = get(channelId)
    // Restore the body as a unit: a late failed GIF must not attach itself to a newer message.
    if (!d.text.value.trim() && !d.gif.value) {
      d.text.value = sent.text
      d.gif.value = sent.gif
      if (!d.reply.value) d.reply.value = sent.reply
    }
    d.uploads.restore(sent.files)
  }

  function send(channelId: string, body: string, draft: OutgoingDraft) {
    const nonce = crypto.randomUUID()
    pending.set(nonce, { channelId, draft })
    const ok = useSocket().send({
      type: 'message:send',
      channelId,
      body,
      nonce,
      replyToId: draft.reply?.id ?? null,
      attachments: draft.files.map(f => ({ id: f.id, spoiler: f.spoiler })),
    })
    if (!ok) {
      pending.delete(nonce)
      restore(channelId, draft)
      toast.add({ title: 'Not connected, try again in a moment', color: 'error', icon: 'i-lucide-wifi-off' })
    }
  }

  return {
    get,
    take,
    send,
    onMessage(m: SocketFrame) {
      if (m.type === 'message:delete') {
        const d = drafts.get(m.channelId)
        if (d && d.reply.value?.id === m.id) d.reply.value = null
        for (const sent of pending.values()) if (sent.channelId === m.channelId && sent.draft.reply?.id === m.id) sent.draft.reply = null
      }
      if (m.type !== 'message:new' && m.type !== 'message:error') return
      const sent = m.nonce ? pending.get(m.nonce) : undefined
      if (m.nonce) pending.delete(m.nonce)
      if (m.type === 'message:error') {
        if (sent) restore(sent.channelId, sent.draft)
        toast.add({ title: m.error, color: 'error', icon: 'i-lucide-circle-alert' })
      }
    },
  }
}

/** The authenticated layout owns the subscriber, not an individual channel view. */
export function useDraftsLive() {
  if (!import.meta.client) return
  const drafts = useDrafts()
  useSocket().on(drafts.onMessage)
}
