// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { transpile } from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'
import { parse } from 'vue/compiler-sfc'

const { descriptor } = parse(readFileSync('app/components/AppSidebar.vue', 'utf8'))
const script = descriptor.scriptSetup!.content
const setup = new Function('ref', 'admin', `${transpile(script.slice(script.indexOf('const dragged =')))}; return { onMemberDragStart, canDrop, onDrop }`)
const dragStart = descriptor.template!.content.match(/@dragstart="([^"]+)"/)![1]

describe('voice member dragging', () => {
  it('rejects non-admin child-avatar drags without arming a target or moving', () => {
    const admin = { isAdmin: ref(false), move: vi.fn() }
    const handlers = setup(ref, admin)
    const app = createApp({
      template: `<li @dragstart="${dragStart}"><img src="/avatar"></li>`,
      setup: () => ({ ...handlers, m: { userId: 'user' }, c: { id: 'source' } }),
    })
    const container = document.createElement('div')
    app.mount(container)
    try {
      const event = new Event('dragstart', { bubbles: true, cancelable: true })
      container.querySelector('img')!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(handlers.canDrop('target')).toBe(false)
      handlers.onDrop('target')
      expect(admin.move).not.toHaveBeenCalled()
    } finally {
      app.unmount()
    }
  })

  it('allows admin moves, ignores the current channel and checks authority again on drop', () => {
    const admin = { isAdmin: ref(true), move: vi.fn() }
    const handlers = setup(ref, admin)
    const row = document.createElement('li')
    const avatar = document.createElement('img')
    row.append(avatar)
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20 } as DOMRect)
    row.addEventListener('dragstart', event => handlers.onMemberDragStart(event, 'user', 'source'))
    const setDragImage = vi.fn()
    const start = () => {
      const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 25, clientY: 30 })
      Object.defineProperty(event, 'dataTransfer', { value: { setDragImage } })
      avatar.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    start()
    expect(setDragImage).toHaveBeenCalledExactlyOnceWith(row, 15, 10)
    expect(handlers.canDrop('source')).toBe(false)
    expect(handlers.canDrop('target')).toBe(true)
    handlers.onDrop('source')
    expect(admin.move).not.toHaveBeenCalled()
    start()
    handlers.onDrop('target')
    expect(admin.move).toHaveBeenCalledExactlyOnceWith('user', 'target')
    expect(handlers.canDrop('target')).toBe(false)
    start()
    admin.isAdmin.value = false
    expect(handlers.canDrop('target')).toBe(false)
    handlers.onDrop('target')
    expect(admin.move).toHaveBeenCalledTimes(1)
  })
})
