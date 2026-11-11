import { cleanMime, MAX_FILE_BYTES, MAX_FILES } from '../../shared/utils/files'

export interface Upload {
  key: string
  name: string
  size: number
  mime: string
  spoiler: boolean
  state: 'uploading' | 'done' | 'error'
  progress: number
  id?: string
  error?: string
  xhr?: XMLHttpRequest
  /** Local blob URL for the staged thumbnail of an image; gone after a failed send (shows as a chip then). */
  preview?: string
}

/** Upload queue of one message input: presign, direct PUT to R2 with progress, cancel. */
export function useUploads() {
  const items = ref<Upload[]>([])
  const toast = useToast()
  const fail = (title: string) => toast.add({ title, color: 'error', icon: 'i-lucide-circle-alert' })

  async function start(it: Upload, file: File) {
    try {
      const p = await $fetch<{ id: string, url: string, headers: Record<string, string> }>('/api/attachments/presign', {
        method: 'POST', body: { filename: file.name, mime: it.mime, size: file.size },
      })
      it.id = p.id
      if (!items.value.some(x => x.key === it.key)) {
        cancelServer(p.id)
        return
      } // cancelled while presigning
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        it.xhr = xhr
        xhr.open('PUT', p.url)
        for (const [k, v] of Object.entries(p.headers)) xhr.setRequestHeader(k, v)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            it.progress = e.loaded / e.total
        }
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`))
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.onabort = () => resolve()
        xhr.send(file)
      })
      if (items.value.some(x => x.key === it.key)) {
        it.state = 'done'
        it.progress = 1
      }
    } catch (error) {
      const e = error as { statusMessage?: string, message?: string, data?: { statusMessage?: string } } | null
      it.state = 'error'
      it.error = e?.statusMessage || e?.data?.statusMessage || e?.message || 'Upload failed'
    }
  }

  function add(files: File[]) {
    for (const file of files) {
      if (items.value.length >= MAX_FILES) return fail(`At most ${MAX_FILES} files per message`)
      if (!file.size) {
        fail(`${file.name} is empty`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        fail(`${file.name} is over ${formatBytes(MAX_FILE_BYTES)}`)
        continue
      }
      const it = reactive<Upload>({
        key: crypto.randomUUID(), name: file.name || 'file', size: file.size,
        mime: cleanMime(file.type) ?? 'application/octet-stream', spoiler: false, state: 'uploading', progress: 0,
      })
      if (it.mime.startsWith('image/')) it.preview = URL.createObjectURL(file)
      items.value.push(it)
      void start(it, file)
    }
  }

  const cancelServer = (id: string) => {
    $fetch(`/api/attachments/${id}/cancel`, { method: 'POST' }).catch(() => {})
  }

  function cancel(key: string) {
    const it = items.value.find(x => x.key === key)
    if (!it) return
    items.value = items.value.filter(x => x.key !== key)
    if (it.preview) URL.revokeObjectURL(it.preview)
    it.xhr?.abort()
    if (it.id) cancelServer(it.id)
  }

  return {
    items,
    add,
    cancel,
    /** After a successful send the server owns the files: forget them without deleting. */
    clear: () => {
      for (const x of items.value)
        if (x.preview)
          URL.revokeObjectURL(x.preview)
      items.value = []
    },
    /** A failed send hands the (already uploaded) files back. */
    restore: (list: Upload[]) => { if (!items.value.length) items.value = list },
    busy: computed(() => items.value.some(x => x.state === 'uploading')),
    ready: computed(() => items.value.filter(x => x.state === 'done' && x.id)),
  }
}
