import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import StillImage from '~/components/chat/StillImage.vue'

const unmounts: (() => void)[] = []
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function mountImage(gif: boolean, enabled: boolean) {
  const setting = useGifOnHover()
  setting.value = enabled
  const onLoad = vi.fn()
  const onError = vi.fn()
  const draw = vi.fn()
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D)
  const wrapper = await mountSuspended(
    defineComponent({ setup: () => () => h('a', [h(StillImage, { src: '/image', alt: 'Image description', gif, onLoad, onError })]) }),
    { attachTo: document.body },
  )
  unmounts.push(() => wrapper.unmount())
  await nextTick()
  const parent = wrapper.element as HTMLElement
  const img = parent.querySelector('img')!
  Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 6000 }, naturalHeight: { value: 4000 } })
  img.dispatchEvent(new Event('load'))
  await nextTick()
  return { parent, img, setting, onLoad, onError, draw, context }
}

describe('GIF still images', () => {
  it.each([false, true])('does not create or draw a canvas for an ordinary image (setting=%s)', async enabled => {
    const { parent, context, onLoad } = await mountImage(false, enabled)
    expect(parent.querySelector('canvas')).toBeNull()
    expect(context).not.toHaveBeenCalled()
    expect(onLoad).toHaveBeenCalled()
  })

  it('snapshots an already-loaded GIF when enabled, including re-enabling', async () => {
    const { parent, img, setting, draw, context, onError } = await mountImage(true, false)
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
    expect(onError).toHaveBeenCalled()
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
