import type { SocketFrame } from '~/composables/useSocket'
import type { MessageDto } from '~~/server/db/messages'

import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody, setResponseStatus } from 'h3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useDrafts, useDraftsLive } from '~/composables/useDrafts'

const mocks = await vi.hoisted(async () => {
  const { onScopeDispose } = await import('vue')
  const handlers = new Set<(m: SocketFrame) => void>()
  return {
    handlers,
    send: vi.fn((_data: { nonce: string }) => true),
    toast: vi.fn(),
    on: (h: (m: SocketFrame) => void) => {
      handlers.add(h)
      onScopeDispose(() => handlers.delete(h))
    },
  }
})
mockNuxtImport('useSocket', () => () => ({ send: mocks.send, on: mocks.on }))
mockNuxtImport('useToast', () => () => ({ add: mocks.toast }))

const presign = vi.fn()
const cancel = vi.fn()
let xhrs: FakeXHR[]
class FakeXHR {
  upload = { onprogress: (_event: Pick<ProgressEvent, 'lengthComputable' | 'loaded' | 'total'>) => {} }
  status = 200
  onload = () => {}
  onabort = () => {}
  onerror = () => {}
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort = vi.fn(() => this.onabort())
  constructor() {
    xhrs.push(this)
  }
}

beforeAll(() => {
  registerEndpoint('/api/attachments/presign', {
    method: 'POST',
    handler: async event => {
      try {
        return await presign(await readBody(event))
      } catch (e) {
        setResponseStatus(event, 400)
        return { message: (e as Error).message }
      }
    },
  })
  for (const id of ['file-id', 'cancelled']) registerEndpoint(`/api/attachments/${id}/cancel`, { method: 'POST', handler: () => (cancel(id), {}) })
})

// Drafts live in module state for the whole session, so every test uses its own channels.
let n = 0
let A: string
let B: string
beforeEach(() => {
  A = `A${++n}`
  B = `B${n}`
  vi.clearAllMocks()
  localStorage.clear()
  mocks.send.mockReturnValue(true)
  mocks.handlers.clear()
  xhrs = []
  presign.mockResolvedValue({ id: 'file-id', url: 'https://upload.test', headers: {} })
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const reply = { id: 'original', name: 'Alice', preview: 'Outside the history slice' }
const deferred = () => {
  let resolve!: (value: unknown) => void
  presign.mockReturnValueOnce(new Promise(r => (resolve = r)))
  return (value: unknown) => resolve(value)
}

describe('per-channel drafts', () => {
  it('keeps the layout subscriber alive across composer scopes and removes it with the layout', () => {
    const drafts = useDrafts()
    const layout = effectScope()
    layout.run(useDraftsLive)
    const composer = effectScope()
    const a = composer.run(() => drafts.get(A))!
    a.text.value = 'sent before navigating'
    drafts.send(A, a.text.value, drafts.take(A))
    const frame = mocks.send.mock.calls[0]![0]
    composer.stop()
    drafts.get(B)
    expect(mocks.handlers.size).toBe(1)
    mocks.handlers.forEach(h => h({ type: 'message:error', nonce: frame.nonce, error: 'Rejected' }))
    expect(a.text.value).toBe('sent before navigating')
    layout.stop()
    expect(mocks.handlers.size).toBe(0)
  })

  it('retains independent text, GIF, reply and attachments after the composer scope is disposed', () => {
    localStorage.setItem(`spk:draft:${A}`, 'saved text')
    const drafts = useDrafts()
    const scope = effectScope()
    const a = scope.run(() => drafts.get(A))!
    expect(a.text.value).toBe('saved text')
    a.gif.value = 'https://gif.test/a'
    a.reply.value = reply
    a.uploads.items.value = [{ key: 'a', name: 'a', size: 1, mime: 'text/plain', state: 'done', progress: 1, id: 'a', spoiler: true }]
    scope.stop()
    const b = drafts.get(B)
    b.text.value = 'B only'
    const restored = useDrafts().get(A)
    expect(restored).toBe(a)
    expect(restored.reply.value).toEqual(reply)
    expect(restored.gif.value).toBe('https://gif.test/a')
    expect(restored.uploads.items.value[0]!.spoiler).toBe(true)
    restored.text.value = 'changed after unmount'
    expect(localStorage.getItem(`spk:draft:${A}`)).toBe('changed after unmount')
    restored.text.value = ''
    expect(localStorage.getItem(`spk:draft:${A}`)).toBeNull()
    expect(b.text.value).toBe('B only')
  })

  it('keeps presign and PUT running off-screen; explicit cancellation still cleans up', async () => {
    const resolvePresign = deferred()
    const drafts = useDrafts()
    const scope = effectScope()
    const a = scope.run(() => drafts.get(A))!
    a.uploads.add([new File(['image'], 'a.png', { type: 'image/png' })])
    scope.stop()
    drafts.get(B)
    resolvePresign({ id: 'file-id', url: 'https://upload.test', headers: {} })
    await vi.waitFor(() => expect(xhrs).toHaveLength(1))
    xhrs[0]!.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 })
    expect(drafts.get(A).uploads.items.value[0]!.progress).toBe(0.5)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    xhrs[0]!.onload()
    await vi.waitFor(() => expect(a.uploads.ready.value).toHaveLength(1))
    expect(a.uploads.busy.value).toBe(false)
    a.uploads.cancel(a.uploads.items.value[0]!.key)
    expect(xhrs[0]!.abort).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    await vi.waitFor(() => expect(cancel).toHaveBeenLastCalledWith('file-id'))
    expect(a.uploads.items.value).toEqual([])
  })

  it('retains upload errors and cancels an attachment removed during presign', async () => {
    const drafts = useDrafts()
    const a = drafts.get(A)
    presign.mockRejectedValueOnce(new Error('Network failed'))
    a.uploads.add([new File(['a'], 'a.txt')])
    await vi.waitFor(() => expect(a.uploads.items.value[0]!.state).toBe('error'))
    expect(drafts.get(A).uploads.items.value[0]!.error).toBe('Network failed')
    a.uploads.cancel(a.uploads.items.value[0]!.key)
    const resolvePresign = deferred()
    a.uploads.add([new File(['a'], 'a.txt')])
    a.uploads.cancel(a.uploads.items.value[0]!.key)
    resolvePresign({ id: 'cancelled', url: 'https://upload.test', headers: {} })
    await vi.waitFor(() => expect(cancel).toHaveBeenLastCalledWith('cancelled'))
    expect(xhrs).toHaveLength(0)
  })

  it('clears before sending and restores an immediate disconnected send including the GIF exactly once', () => {
    const drafts = useDrafts()
    const a = drafts.get(A)
    a.text.value = 'caption'
    a.gif.value = 'https://gif.test/a'
    a.reply.value = reply
    mocks.send.mockReturnValue(false)
    const outgoing = drafts.take(A)
    expect(a.text.value).toBe('')
    expect(a.reply.value).toBeNull()
    drafts.send(A, 'caption\n\nhttps://gif.test/a', outgoing)
    expect(a.text.value).toBe('caption')
    expect(a.gif.value).toBe('https://gif.test/a')
    expect(a.reply.value).toEqual(reply)
    expect(localStorage.getItem(`spk:draft:${A}`)).toBe('caption')
    expect(mocks.toast).toHaveBeenCalledOnce()
  })

  it('restores delayed failures to the originating channel after remount, keeping files out of the in-flight draft', () => {
    const drafts = useDrafts()
    const a = drafts.get(A)
    a.text.value = 'A message'
    a.reply.value = reply
    a.uploads.items.value = [
      { key: 'a', id: 'file', name: 'a', mime: 'image/png', size: 1, spoiler: true, state: 'done', progress: 1, preview: 'blob:preview' },
    ]
    drafts.send(A, 'A message', drafts.take(A))
    const frame = mocks.send.mock.calls[0]![0]
    expect(a.uploads.items.value).toEqual([])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    const b = drafts.get(B)
    b.text.value = 'B message'
    useDrafts().onMessage({ type: 'message:error', nonce: frame.nonce, error: 'Rejected' })
    expect(a.text.value).toBe('A message')
    expect(a.reply.value).toEqual(reply)
    expect(a.uploads.items.value[0]).toMatchObject({ id: 'file', spoiler: true, preview: undefined })
    expect(b.text.value).toBe('B message')
  })

  it('never overwrites newer contents on an error or clears them on an acknowledgement', () => {
    const drafts = useDrafts()
    const a = drafts.get(A)
    a.text.value = 'old'
    a.gif.value = 'old gif'
    drafts.send(A, 'old body', drafts.take(A))
    const frame = mocks.send.mock.calls[0]![0]
    a.text.value = 'new'
    a.gif.value = 'new gif'
    a.reply.value = { ...reply, id: 'new reply' }
    a.uploads.items.value = [{ key: 'new', name: 'new', size: 1, mime: 'text/plain', spoiler: false, state: 'error', progress: 0 }]
    drafts.onMessage({ type: 'message:error', nonce: frame.nonce, error: 'Rejected' })
    expect(a.text.value).toBe('new')
    expect(a.gif.value).toBe('new gif')
    expect(a.reply.value!.id).toBe('new reply')
    expect(a.uploads.items.value[0]!.key).toBe('new')
    drafts.send(A, 'new body', drafts.take(A))
    const success = mocks.send.mock.calls[1]![0]
    a.text.value = 'third message'
    drafts.onMessage({ type: 'message:new', nonce: success.nonce, message: { channelId: A } as MessageDto })
    drafts.onMessage({ type: 'message:error', nonce: success.nonce, error: 'Unrelated' })
    expect(a.text.value).toBe('third message')
    expect(a.gif.value).toBeNull()
  })

  it('clears known deleted reply targets even while their channel or send is off-screen', () => {
    const drafts = useDrafts()
    const a = drafts.get(A)
    a.text.value = 'reply'
    a.reply.value = reply
    drafts.send(A, 'reply', drafts.take(A))
    a.reply.value = reply
    drafts.onMessage({ type: 'message:delete', channelId: B, id: reply.id })
    expect(a.reply.value).toEqual(reply)
    drafts.onMessage({ type: 'message:delete', channelId: A, id: reply.id })
    expect(a.reply.value).toBeNull()
    const frame = mocks.send.mock.calls[0]![0]
    drafts.onMessage({ type: 'message:error', nonce: frame.nonce, error: 'Deleted' })
    expect(a.reply.value).toBeNull()
  })
})
