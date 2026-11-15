import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'

import EmojiText from '~/components/EmojiText.vue'

describe('EmojiText', () => {
  it.each([
    [['plain text'], []],
    [[''], []],
    [
      ['', '😀', '', '🇫🇷', ''],
      ['😀', '🇫🇷'],
    ],
    [
      ['Hello ', '👩🏽‍💻', ' <b>world</b> ', '👍🏽', '!'],
      ['👩🏽‍💻', '👍🏽'],
    ],
  ])('renders alternating text and emoji parts: %j', async (parts, emojis) => {
    const text = parts.join('')
    const wrapper = await mountSuspended(EmojiText, { props: { text }, attrs: { class: 'truncate' } })

    expect(wrapper.classes()).toContain('truncate')
    expect(wrapper.findAll('img').map(img => img.attributes('alt'))).toEqual(emojis)
    expect(wrapper.find('b').exists()).toBe(false)
    for (const img of wrapper.findAll('img')) await img.trigger('error')
    expect(wrapper.text()).toBe(text)
  })

  it('updates when the text prop changes', async () => {
    const wrapper = await mountSuspended(EmojiText, { props: { text: '😀' } })
    await wrapper.setProps({ text: 'updated' })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('updated')
  })
})
