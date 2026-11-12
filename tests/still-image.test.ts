// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { useEventListener } from '@vueuse/core'
import { transpile } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, nextTick, onMounted, ref, watchPostEffect } from 'vue'
import { parse } from 'vue/compiler-sfc'

const { descriptor } = parse(readFileSync('app/components/chat/StillImage.vue', 'utf8'))
const setup = new Function(
  'defineOptions',
  'defineProps',
  'defineEmits',
  'useGifOnHover',
  'ref',
  'computed',
  'onMounted',
  'watchPostEffect',
  'useEventListener',
  `${transpile(descriptor.scriptSetup!.content)}; return { wrap, img, canvas, still, stilled, onHover, onLoad, emit }`,
)
const unmounts: (() => void)[] = []
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount()
  vi.restoreAllMocks()
})

async function mountImage(gif: boolean, enabled: boolean) {
  const setting = ref(enabled)
  const emit = vi.fn()
  const draw = vi.fn()
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D)
  const props = { src: '/image', alt: 'Image description', gif }
  const app = createApp({
    inheritAttrs: false,
    template: descriptor.template!.content,
    setup: () => ({
      ...props,
      ...setup(
        vi.fn(),
        () => props,
        () => emit,
        () => setting,
        ref,
        computed,
        onMounted,
        watchPostEffect,
        useEventListener,
      ),
    }),
  })
  const parent = document.createElement('a')
  app.mount(parent)
  unmounts.push(() => app.unmount())
  await nextTick()
  const img = parent.querySelector('img')!
  Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 6000 }, naturalHeight: { value: 4000 } })
  img.dispatchEvent(new Event('load'))
  await nextTick()
  return { parent, img, setting, emit, draw, context }
}

describe('GIF still images', () => {
  it.each([false, true])('does not create or draw a canvas for an ordinary image (setting=%s)', async enabled => {
    const { parent, context, emit } = await mountImage(false, enabled)
    expect(parent.querySelector('canvas')).toBeNull()
    expect(context).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('load')
  })

  it('snapshots an already-loaded GIF when enabled, including re-enabling', async () => {
    const { parent, img, setting, draw, context, emit } = await mountImage(true, false)
    expect(context).not.toHaveBeenCalled()
    expect(parent.querySelector('canvas')).toBeNull()
    for (let i = 0; i < 2; i++) {
      setting.value = true
      await nextTick()
      expect(draw).toHaveBeenCalledWith(img, 0, 0)
      expect(parent.querySelector('canvas')!.width).toBe(6000)
      expect(img.classList.contains('invisible')).toBe(true)
      setting.value = false
      await nextTick()
      expect(parent.querySelector('canvas')).toBeNull()
      expect(img.classList.contains('invisible')).toBe(false)
    }
    img.dispatchEvent(new Event('error'))
    expect(emit).toHaveBeenCalledWith('error')
  })

  it('plays while either hover or focus remains active', async () => {
    const { parent, img } = await mountImage(true, true)
    for (const events of [
      ['focusin', 'pointerenter', 'pointerleave', 'focusout'],
      ['pointerenter', 'focusin', 'focusout', 'pointerleave'],
    ] as const) {
      for (const event of events.slice(0, 3)) {
        parent.dispatchEvent(new Event(event))
        await nextTick()
        expect(img.classList.contains('invisible')).toBe(false)
      }
      parent.dispatchEvent(new Event(events[3]))
      await nextTick()
      expect(img.classList.contains('invisible')).toBe(true)
    }
  })
})
