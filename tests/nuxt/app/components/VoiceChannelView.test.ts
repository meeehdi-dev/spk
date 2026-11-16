import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import VoiceChannelView from '~/components/VoiceChannelView.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const voice = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    channelId: ref('voice'),
    connecting: ref(false),
    connectionLabel: ref('Connected'),
    theater: ref<string | null>('streamer'),
    tiles: ref([{ userId: 'streamer' }, { userId: 'participant' }]),
  }
})
mockNuxtImport('useVoice', () => () => voice)
mockNuxtImport('useUsers', () => () => ({ data: { value: [] }, byId: new Map() }))
mockNuxtImport('voiceMembers', () => () => [{ userId: 'streamer' }, { userId: 'participant' }])

it('collapses the theater strip without unmounting tiles and resets when theater mode ends', async () => {
  const wrapper = await mountInApp(
    VoiceChannelView,
    { channelId: 'voice' },
    {
      global: {
        stubs: {
          VoiceTile: {
            props: { tile: { type: Object, required: true }, theater: Boolean },
            template: '<div :data-user="tile.userId" :data-theater="theater" />',
          },
          VoiceControl: true,
          SoundboardPopover: true,
          RadioPopover: true,
        },
      },
    },
  )
  expect(wrapper.text()).not.toContain('Connected')
  expect(wrapper.html()).not.toContain('voice-reconnect')
  expect(wrapper.html().indexOf('<radio-popover-stub')).toBeLessThan(wrapper.html().indexOf('<soundboard-popover-stub'))
  const participantGroup = wrapper.get('[data-user="participant"]').element.parentElement
  const groupClasses = participantGroup!.className
  voice.connectionLabel.value = 'Voice interrupted. Reconnecting…'
  await nextTick()
  const status = wrapper.get('[role="status"]')
  expect(status.text()).toContain('Voice interrupted')
  expect(status.classes()).toEqual(expect.arrayContaining(['absolute', 'pointer-events-none']))
  expect(participantGroup!.contains(status.element)).toBe(false)
  expect(wrapper.get('[data-user="participant"]').element.parentElement).toBe(participantGroup)
  expect(participantGroup!.className).toBe(groupClasses)
  voice.connectionLabel.value = 'Connected'
  await nextTick()

  const participant = wrapper.get('[data-user="participant"]')
  const participantElement = participant.element
  const strip = participant.element.parentElement as HTMLElement
  const focused = () => wrapper.get('[data-theater="true"]')
  const hide = () => wrapper.get('button[aria-label="Hide participants"]')
  const show = () => wrapper.get('button[aria-label="Show participants"]')

  expect(participant.isVisible()).toBe(true)
  expect(hide().text()).toBe('Hide participants')
  expect(hide().element.previousElementSibling?.getAttribute('kind')).toBe('leave')
  expect(hide().attributes('aria-expanded')).toBe('true')
  expect(hide().attributes('aria-controls')).toBe(participant.element.parentElement!.id)
  await hide().trigger('click')
  expect(strip.style.display).toBe('none')
  expect(wrapper.get('[data-user="participant"]').element).toBe(participantElement)
  expect(focused().isVisible()).toBe(true)
  expect(show().text()).toBe('Show participants')
  expect(show().element.previousElementSibling?.getAttribute('kind')).toBe('leave')
  expect(show().attributes('aria-expanded')).toBe('false')
  await show().trigger('click')
  expect(strip.style.display).not.toBe('none')
  expect(participant.isVisible()).toBe(true)

  await hide().trigger('click')
  voice.theater.value = null
  await nextTick()
  expect(strip.style.display).not.toBe('none')
  expect(participant.isVisible()).toBe(true)
  expect(wrapper.find('button[aria-controls]').exists()).toBe(false)
  expect(wrapper.find('[data-theater="true"]').exists()).toBe(false)

  voice.theater.value = 'streamer'
  await nextTick()
  expect(participant.isVisible()).toBe(true)
  expect(hide().attributes('aria-expanded')).toBe('true')
})
