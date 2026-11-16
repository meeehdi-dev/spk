import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

import ProseA from '~/components/mdc/ProseA.vue'
import { chatActionsKey } from '~/composables/messageContext'

describe('inline image links', () => {
  it.each(['png', 'gif'])('opens %s images in the lightbox', async extension => {
    const openImage = vi.fn()
    const href = `https://example.com/image.${extension}`
    const wrapper = await mountSuspended(ProseA, {
      props: { href },
      global: { provide: { [chatActionsKey as symbol]: { openImage } } },
    })
    expect(wrapper.find('a').exists()).toBe(false)
    await wrapper.find('button').trigger('click')
    expect(openImage).toHaveBeenCalledWith(href)
  })

  it('keeps ordinary links and plain image links as links', async () => {
    for (const props of [{ href: 'https://example.com/page' }, { href: 'https://example.com/image.png', plain: true }]) {
      const wrapper = await mountSuspended(ProseA, { props })
      expect(wrapper.find('a').attributes('href')).toBe(props.href)
      expect(wrapper.find('a').attributes('target')).toBe('_blank')
    }
  })
})
