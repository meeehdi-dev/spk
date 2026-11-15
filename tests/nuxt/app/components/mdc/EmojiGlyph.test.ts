import { version } from '@iconify-json/twemoji/package.json'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'

import EmojiGlyph from '~/components/mdc/EmojiGlyph.vue'

describe('EmojiGlyph', () => {
  it.each([
    ['😀', '1f600'],
    ['👍🏽', '1f44d-1f3fd'],
    ['🇫🇷', '1f1eb-1f1f7'],
    ['❤️', '2764'],
    ['1️⃣', '0031-20e3'],
    ['©️', '00a9'],
    ['👩🏽‍💻', '1f469-1f3fd-200d-1f4bb'],
    ['🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', '1f3f4-e0067-e0062-e0065-e006e-e0067-e007f'],
  ])('renders %s as a local SVG with Unicode alternative text', async (emoji, code) => {
    const wrapper = await mountSuspended(EmojiGlyph, { props: { emoji } })
    expect(wrapper.find('img').attributes()).toMatchObject({ src: `/twemoji/${version}/${code}.svg`, alt: emoji, draggable: 'false' })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['inline-flex', 'items-center', 'justify-center', 'size-[1em]']))
    expect(wrapper.find('img').classes()).toContain('object-contain')
  })

  it('falls back to Unicode on missing or failed artwork and retries when the emoji changes', async () => {
    const wrapper = await mountSuspended(EmojiGlyph, { props: { emoji: '😀' } })
    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('😀')
    await wrapper.setProps({ emoji: '👍🏽' })
    expect(wrapper.find('img').attributes('alt')).toBe('👍🏽')
    await wrapper.find('img').trigger('error')
    expect(wrapper.text()).toBe('👍🏽')
  })
})
