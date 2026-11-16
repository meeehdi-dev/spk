import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'

import ProseA from '~/components/mdc/ProseA.vue'
import SpoilerText from '~/components/mdc/SpoilerText.vue'
import { chatActionsKey } from '~/composables/messageContext'

describe('spoiler reveal', () => {
  it('intercepts the first image click, then allows the lightbox without hiding again', async () => {
    const openImage = vi.fn()
    const href = 'https://example.com/image.gif'
    const wrapper = await mountSuspended(SpoilerText, {
      slots: { default: () => h(ProseA, { href }) },
      global: { provide: { [chatActionsKey as symbol]: { openImage } } },
    })
    const button = wrapper.find('button')
    await button.trigger('click')
    expect(openImage).not.toHaveBeenCalled()
    expect(wrapper.find('[inert]').exists()).toBe(false)
    await button.trigger('click')
    expect(openImage).toHaveBeenCalledWith(href)
    expect(wrapper.find('[inert]').exists()).toBe(false)
  })

  it.each(['Enter', ' '])('reveals with the %s key without activating its link', async key => {
    const click = vi.fn()
    const wrapper = await mountSuspended(SpoilerText, {
      slots: { default: () => h('a', { href: 'https://example.com', onClick: click }, 'secret') },
    })
    expect(wrapper.find('[inert]').exists()).toBe(true)
    await wrapper.trigger('keydown', { key })
    expect(wrapper.attributes('role')).toBeUndefined()
    expect(wrapper.find('[inert]').exists()).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })

  it('prevents navigation when revealing a hidden link', async () => {
    const wrapper = await mountSuspended(SpoilerText, { slots: { default: '<a href="https://example.com">secret</a>' } })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    wrapper.find('a').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
