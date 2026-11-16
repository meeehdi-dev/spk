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
    pendingChannelId: ref<string | null>(null),
    me: ref({ id: 'self' }),
    playing: ref({}),
    leave: vi.fn(),
    connectionLabel: ref('Connected'),
    theater: ref<string | null>('streamer'),
    tiles: ref([{ userId: 'streamer' }, { userId: 'participant' }]),
  }
})
mockNuxtImport('useVoice', () => () => voice)
mockNuxtImport('useUsers', () => () => ({ data: { value: [] }, byId: new Map() }))
mockNuxtImport(
  'voiceDisplayMembers',
  () => () =>
    voice.pendingChannelId.value
      ? [{ userId: 'self', pending: true }]
      : [
          { userId: 'streamer', pending: false },
          { userId: 'participant', pending: false },
        ],
)

it('shows pending self with connecting status and cancel, but no media controls', async () => {
  voice.channelId.value = ''
  voice.pendingChannelId.value = 'voice'
  voice.connecting.value = true
  const wrapper = await mountInApp(VoiceChannelView, { channelId: 'voice' })
  expect(wrapper.get('li').classes()).toContain('opacity-50')
  expect(wrapper.get('[role="status"]').text()).toBe('Connecting…')
  expect(wrapper.text()).not.toContain('Nobody is here yet')
  expect(wrapper.findComponent({ name: 'VoiceControl' }).exists()).toBe(false)
  expect(wrapper.findComponent({ name: 'VoiceTile' }).exists()).toBe(false)
  expect(wrapper.findAll('button').map(b => b.text())).toEqual(['Cancel'])
  await wrapper.get('button').trigger('click')
  expect(voice.leave).toHaveBeenCalledWith(false)
  wrapper.unmount()
  voice.channelId.value = 'voice'
  voice.pendingChannelId.value = null
  voice.connecting.value = false
})

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
