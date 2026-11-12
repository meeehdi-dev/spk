// @vitest-environment happy-dom
import type { Ref } from 'vue'

import { readFileSync } from 'node:fs'

import { useEventListener, useResizeObserver } from '@vueuse/core'
import { transpile } from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const source = readFileSync('app/components/chat/ChatMessage.vue', 'utf8')
const positioning = source.slice(source.indexOf('const root ='), source.indexOf('const plain ='))
const setup = new Function('props', 'ref', 'useResizeObserver', 'useEventListener', `${transpile(positioning)}; return { root, toolbar, toolbarStyle }`)

describe('message toolbar positioning', () => {
  it('follows an earlier sibling growing using only the content resize signal while a menu keeps the toolbar visible', async () => {
    const observers = new Set<{ targets: Set<Element>; callback: ResizeObserverCallback }>()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        targets = new Set<Element>()
        constructor(public callback: ResizeObserverCallback) {
          observers.add(this)
        }
        observe(target: Element) {
          this.targets.add(target)
        }
        disconnect() {
          this.targets.clear()
          observers.delete(this)
        }
      },
    )
    const scroller = document.createElement('div')
    const content = document.createElement('div')
    const earlier = document.createElement('div')
    const row = document.createElement('div')
    const toolbar = document.createElement('div')
    scroller.append(content)
    content.append(earlier, row)
    row.append(toolbar)
    scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
    let earlierHeight = 100
    row.getBoundingClientRect = () => ({ top: 100 + earlierHeight, bottom: 160 + earlierHeight, right: 800, width: 600 }) as DOMRect
    Object.defineProperty(toolbar, 'offsetHeight', { value: 38 })
    const notifyResize = (target: Element) => {
      for (const observer of [...observers]) {
        if (observer.targets.has(target)) observer.callback([{ target } as ResizeObserverEntry], observer as unknown as ResizeObserver)
      }
    }
    const scope = effectScope()
    try {
      const state = scope.run(() => setup({ scroller, content }, ref, useResizeObserver, useEventListener)) as {
        root: Ref<HTMLElement>
        toolbar: Ref<HTMLElement>
        toolbarStyle: Ref<{ top: string }>
      }
      state.root.value = row
      state.toolbar.value = toolbar
      await nextTick()
      notifyResize(toolbar)
      await nextTick()
      expect(state.toolbarStyle.value.top).toBe('200px')
      expect([...observers].some(observer => observer.targets.has(content))).toBe(true)
      // Only the earlier sibling and content change size; the row, toolbar, viewport and scrollTop do not.
      earlierHeight = 200
      earlier.style.height = `${earlierHeight}px`
      notifyResize(content)
      await nextTick()
      expect(state.toolbarStyle.value.top).toBe('300px')
      expect(scroller.scrollTop).toBe(0)
      expect(source).toContain(":class=\"picker || moreOpen ? '!flex' : ''\"")
      expect(readFileSync('app/components/chat/ChannelView.vue', 'utf8')).toContain(':content="content"')
    } finally {
      scope.stop()
      vi.unstubAllGlobals()
    }
    expect(observers.size).toBe(0)
  })

  it('escapes scrollport clipping without covering the following row, including short compact and partially scrolled tall rows', async () => {
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
    let resize!: () => void
    const scope = effectScope()
    const state = scope.run(() => setup({ scroller }, ref, (_targets: unknown, callback: () => void) => (resize = callback), useEventListener)) as {
      root: Ref<HTMLElement>
      toolbar: Ref<HTMLElement>
      toolbarStyle: Ref<{ top: string; left: string; maxWidth: string }>
    }
    try {
      state.root.value = document.createElement('div')
      state.toolbar.value = document.createElement('div')
      let height = 38
      let rowTop = 200
      let rowHeight = 24
      let rowWidth = 300
      Object.defineProperty(state.toolbar.value, 'offsetHeight', { get: () => height })
      state.root.value.getBoundingClientRect = () => ({ top: rowTop, bottom: rowTop + rowHeight, right: 400, width: rowWidth }) as DOMRect
      resize()
      await nextTick()
      expect(state.toolbarStyle.value).toEqual({ top: '200px', left: '384px', maxWidth: '268px' })
      // The toolbar remains centered on the upper edge away from the viewport boundary.
      expect(parseFloat(state.toolbarStyle.value.top) + height / 2).toBeLessThanOrEqual(rowTop + rowHeight)
      for (const [top, size] of [
        [100, 24],
        [90, 24],
        [-200, 600],
      ]) {
        rowTop = top!
        rowHeight = size!
        scroller.dispatchEvent(new Event('scroll'))
        const center = parseFloat(state.toolbarStyle.value.top)
        expect(center - height / 2).toBeGreaterThanOrEqual(0)
        expect(center + height / 2).toBeLessThanOrEqual(rowTop + rowHeight)
      }
      expect(state.toolbarStyle.value.top).toBe('100px')
      height = 0
      resize()
      await nextTick()
      const previous = state.toolbarStyle.value
      rowTop = 300
      scroller.dispatchEvent(new Event('scroll'))
      expect(state.toolbarStyle.value).toBe(previous)
      height = 38
      resize()
      expect(state.toolbarStyle.value.top).toBe('300px')
      rowWidth = 90
      resize()
      expect(state.toolbarStyle.value.maxWidth).toBe('58px')
      expect(source).toContain('class="fixed z-10 hidden w-max -translate-x-full -translate-y-1/2')
    } finally {
      scope.stop()
    }
  })
})
