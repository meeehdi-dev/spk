import { describe, expect, it } from 'vitest'

import IconSelect from '~/components/IconSelect.vue'
import { mountInApp } from '~~/tests/fixtures/app'

describe('IconSelect', () => {
  it('shows the selected lucide icon and passes aria-label through', async () => {
    const wrapper = await mountInApp(IconSelect, { modelValue: 'audio-lines', 'aria-label': 'Icon' })
    expect(wrapper.find('button[aria-label="Icon"]').exists()).toBe(true)
    expect(wrapper.find('.i-lucide\\:audio-lines').exists()).toBe(true)
  })
})
