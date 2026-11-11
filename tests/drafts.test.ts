// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, onScopeDispose, reactive, ref } from 'vue'

const send = vi.fn((_data: unknown) => true)
const toast = vi.fn()
const fetch = vi.fn()
let xhrs: FakeXHR[]
let handlers: Set<(m: any) => void>
class FakeXHR {
  upload = { onprogress: null as any }
  status = 200
  onload = () => {}
  onabort = () => {}
  onerror = () => {}
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort = vi.fn(() => this.onabort())
  constructor() { xhrs.push(this) }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  send.mockReturnValue(true)
  xhrs = []
  handlers = new Set()
  fetch.mockResolvedValue({ id: 'file-id', url: 'https://upload.test', headers: {} })
  for (const [key, value] of Object.entries({
    ref, reactive, computed, useToast: () => ({ add: toast }),
    useSocket: () => ({ send, on: (h: (m: any) => void) => {
      handlers.add(h)
      onScopeDispose(() => handlers.delete(h))
    } }),
    $fetch: fetch, XMLHttpRequest: FakeXHR, errorText: (e: Error) => e.message,
    formatBytes: (n: number) => String(n)
  })) vi.stubGlobal(key, value)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const setup = async () => (await import('../app/composables/useDrafts')).useDrafts()
const reply = { id: 'original', name: 'Alice', preview: 'Outside the history slice' }

describe('per-channel drafts', () => {
  it('keeps the layout subscriber alive across composer scopes and removes it with the layout', async () => {
    const { useDraftsLive } = await import('../app/composables/useDrafts')
    const drafts = await setup()
    const layout = effectScope()
    layout.run(useDraftsLive)
    const composer = effectScope()
    const a = composer.run(() => drafts.get('A'))!
    a.text.value = 'sent before navigating'
    drafts.send('A', a.text.value, drafts.take('A'))
    const frame = send.mock.calls[0]![0] as any
    composer.stop()
    drafts.get('B')
    expect(handlers.size).toBe(1)
    handlers.forEach(h => h({ type: 'message:error', nonce: frame.nonce, error: 'Rejected' }))
    expect(a.text.value).toBe('sent before navigating')
    layout.stop()
    expect(handlers.size).toBe(0)
  })

  it('retains independent text, GIF, reply and attachments after the composer scope is disposed', async () => {
    localStorage.setItem('spk:draft:A', 'saved text')
    const drafts = await setup()
    const scope = effectScope()
    const a = scope.run(() => drafts.get('A'))!
    expect(a.text.value).toBe('saved text')
    a.gif.value = 'https://gif.test/a'
    a.reply.value = reply
    a.uploads.items.value = [{ key: 'a', name: 'a', size: 1, mime: 'text/plain', state: 'done', progress: 1, id: 'a', spoiler: true }]
    scope.stop()
    const b = drafts.get('B')
    b.text.value = 'B only'
    const restored = (await setup()).get('A')
    expect(restored).toBe(a)
    expect(restored.reply.value).toEqual(reply)
    expect(restored.gif.value).toBe('https://gif.test/a')
    expect(restored.uploads.items.value[0]!.spoiler).toBe(true)
    restored.text.value = 'changed after unmount'
    expect(localStorage.getItem('spk:draft:A')).toBe('changed after unmount')
    restored.text.value = ''
    expect(localStorage.getItem('spk:draft:A')).toBeNull()
    expect(b.text.value).toBe('B only')
  })

  it('keeps presign and PUT running off-screen; explicit cancellation still cleans up', async () => {
    let presign!: (value: any) => void
    fetch.mockReturnValueOnce(new Promise(resolve => { presign = resolve }))
    const drafts = await setup()
    const scope = effectScope()
    const a = scope.run(() => drafts.get('A'))!
    a.uploads.add([new File(['image'], 'a.png', { type: 'image/png' })])
    scope.stop()
    drafts.get('B')
    presign({ id: 'file-id', url: 'https://upload.test', headers: {} })
    await vi.waitFor(() => expect(xhrs).toHaveLength(1))
    xhrs[0]!.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 })
    expect(drafts.get('A').uploads.items.value[0]!.progress).toBe(0.5)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    xhrs[0]!.onload()
    await vi.waitFor(() => expect(a.uploads.ready.value).toHaveLength(1))
    expect(a.uploads.busy.value).toBe(false)
    a.uploads.cancel(a.uploads.items.value[0]!.key)
    expect(xhrs[0]!.abort).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    expect(fetch).toHaveBeenLastCalledWith('/api/attachments/file-id/cancel', { method: 'POST' })
    expect(a.uploads.items.value).toEqual([])
  })

  it('retains upload errors and cancels an attachment removed during presign', async () => {
    const drafts = await setup()
    const a = drafts.get('A')
    fetch.mockRejectedValueOnce(new Error('Network failed'))
    a.uploads.add([new File(['a'], 'a.txt')])
    await vi.waitFor(() => expect(a.uploads.items.value[0]!.state).toBe('error'))
    expect(drafts.get('A').uploads.items.value[0]!.error).toBe('Network failed')
    a.uploads.cancel(a.uploads.items.value[0]!.key)
    let presign!: (value: any) => void
    fetch.mockReturnValueOnce(new Promise(resolve => { presign = resolve }))
    a.uploads.add([new File(['a'], 'a.txt')])
    a.uploads.cancel(a.uploads.items.value[0]!.key)
    presign({ id: 'cancelled', url: 'https://upload.test', headers: {} })
    await vi.waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/attachments/cancelled/cancel', { method: 'POST' }))
    expect(xhrs).toHaveLength(0)
  })

  it('clears before sending and restores an immediate disconnected send including the GIF exactly once', async () => {
    const drafts = await setup()
    const a = drafts.get('A')
    a.text.value = 'caption'
    a.gif.value = 'https://gif.test/a'
    a.reply.value = reply
    send.mockReturnValue(false)
    const outgoing = drafts.take('A')
    expect(a.text.value).toBe('')
    expect(a.reply.value).toBeNull()
    drafts.send('A', 'caption\n\nhttps://gif.test/a', outgoing)
    expect(a.text.value).toBe('caption')
    expect(a.gif.value).toBe('https://gif.test/a')
    expect(a.reply.value).toEqual(reply)
    expect(localStorage.getItem('spk:draft:A')).toBe('caption')
    expect(toast).toHaveBeenCalledOnce()
  })

  it('restores delayed failures to the originating channel after remount, keeping files out of the in-flight draft', async () => {
    const drafts = await setup()
    const a = drafts.get('A')
    a.text.value = 'A message'
    a.reply.value = reply
    a.uploads.items.value = [{ key: 'a', id: 'file', name: 'a', mime: 'image/png', size: 1, spoiler: true, state: 'done', progress: 1, preview: 'blob:preview' }]
    drafts.send('A', 'A message', drafts.take('A'))
    const frame = send.mock.calls[0]![0] as any
    expect(a.uploads.items.value).toEqual([])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    const b = drafts.get('B')
    b.text.value = 'B message'
    ;(await setup()).onMessage({ type: 'message:error', nonce: frame.nonce, error: 'Rejected' })
    expect(a.text.value).toBe('A message')
    expect(a.reply.value).toEqual(reply)
    expect(a.uploads.items.value[0]).toMatchObject({ id: 'file', spoiler: true, preview: undefined })
    expect(b.text.value).toBe('B message')
  })

  it('never overwrites newer contents on an error or clears them on an acknowledgement', async () => {
    const drafts = await setup()
    const a = drafts.get('A')
    a.text.value = 'old'
    a.gif.value = 'old gif'
    drafts.send('A', 'old body', drafts.take('A'))
    const frame = send.mock.calls[0]![0] as any
    a.text.value = 'new'
    a.gif.value = 'new gif'
    a.reply.value = { ...reply, id: 'new reply' }
    a.uploads.items.value = [{ key: 'new', name: 'new', size: 1, mime: 'text/plain', spoiler: false, state: 'error', progress: 0 }]
    drafts.onMessage({ type: 'message:error', nonce: frame.nonce, error: 'Rejected' })
    expect(a.text.value).toBe('new')
    expect(a.gif.value).toBe('new gif')
    expect(a.reply.value.id).toBe('new reply')
    expect(a.uploads.items.value[0]!.key).toBe('new')
    drafts.send('A', 'new body', drafts.take('A'))
    const success = send.mock.calls[1]![0] as any
    a.text.value = 'third message'
    drafts.onMessage({ type: 'message:new', nonce: success.nonce, message: { channelId: 'A' } })
    drafts.onMessage({ type: 'message:error', nonce: success.nonce, error: 'Unrelated' })
    expect(a.text.value).toBe('third message')
    expect(a.gif.value).toBeNull()
  })

  it('clears known deleted reply targets even while their channel or send is off-screen', async () => {
    const drafts = await setup()
    const a = drafts.get('A')
    a.text.value = 'reply'
    a.reply.value = reply
    drafts.send('A', 'reply', drafts.take('A'))
    a.reply.value = reply
    drafts.onMessage({ type: 'message:delete', channelId: 'B', id: reply.id })
    expect(a.reply.value).toEqual(reply)
    drafts.onMessage({ type: 'message:delete', channelId: 'A', id: reply.id })
    expect(a.reply.value).toBeNull()
    const frame = send.mock.calls[0]![0] as any
    drafts.onMessage({ type: 'message:error', nonce: frame.nonce, error: 'Deleted' })
    expect(a.reply.value).toBeNull()
  })
})
