import { mountSuspended } from '@nuxt/test-utils/runtime'
import { expect, it, vi } from 'vitest'

import VoiceMediaView from '~/components/VoiceMediaView.vue'

it('attaches tracks and detaches the old track on replacement, removal, and unmount', async () => {
  const first = { attach: vi.fn(), detach: vi.fn() }
  const second = { attach: vi.fn(), detach: vi.fn() }
  const wrapper = await mountSuspended(VoiceMediaView, { props: { track: first } })
  const element = wrapper.get('video').element
  expect(first.attach).toHaveBeenCalledExactlyOnceWith(element)
  expect(element.autoplay).toBe(true)
  expect(element.muted).toBe(true)
  expect(element.hasAttribute('playsinline')).toBe(true)
  await wrapper.setProps({ track: second })
  expect(first.detach).toHaveBeenCalledExactlyOnceWith(element)
  expect(second.attach).toHaveBeenCalledExactlyOnceWith(element)
  await wrapper.setProps({ track: undefined })
  expect(second.detach).toHaveBeenCalledExactlyOnceWith(element)
  expect(element.style.display).toBe('none')
  await wrapper.setProps({ track: first })
  wrapper.unmount()
  expect(first.detach).toHaveBeenCalledTimes(2)
})
