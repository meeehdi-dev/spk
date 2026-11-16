import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ImageLightbox from '~/components/chat/ImageLightbox.vue'

describe('image lightbox', () => {
  it.each([
    { file: 'https://example.com/image.gif', src: 'https://example.com/image.gif', alt: 'Image' },
    { file: { id: 'file', filename: 'photo.png', mime: 'image/png', size: 10, spoiler: false }, src: '/api/attachments/file', alt: 'photo.png' },
  ])('displays $src and closes on Escape, restoring focus', async ({ file, src, alt }) => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    const wrapper = await mountSuspended(ImageLightbox, { props: { file: null }, attachTo: document.body })
    trigger.focus()
    await wrapper.setProps({ file })
    await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(src)
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe(alt)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('close')).toEqual([[]])
    await wrapper.setProps({ file: null })
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
    trigger.remove()
  })
})
