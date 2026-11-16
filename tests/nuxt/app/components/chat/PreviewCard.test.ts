import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

import PreviewCard from '~/components/chat/PreviewCard.vue'
import { chatActionsKey } from '~/composables/messageContext'

describe('preview images', () => {
  it('opens the thumbnail in the lightbox while keeping the card text as a link', async () => {
    const openImage = vi.fn()
    const url = 'https://example.com/page'
    const wrapper = await mountSuspended(PreviewCard, {
      props: { messageId: 'message', preview: { url, title: 'Page', description: null, siteName: null, image: true }, canRemove: false },
      global: { provide: { [chatActionsKey as symbol]: { openImage } } },
    })
    expect(wrapper.find('a').attributes('href')).toBe(url)
    expect(wrapper.find('a img').exists()).toBe(false)
    await wrapper.find('button').trigger('click')
    expect(openImage).toHaveBeenCalledWith(`/api/messages/message/preview-image?url=${encodeURIComponent(url)}`)
  })
})
