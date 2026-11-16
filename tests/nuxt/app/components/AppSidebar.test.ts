import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import AppSidebar from '~/components/AppSidebar.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const role = vi.hoisted(() => ({ value: 'user' }))
const member = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return reactive({ userId: 'user', channelId: 'source', radioListening: false, cam: false, screen: false })
})
const move = vi.fn()
mockNuxtImport('voiceMembers', () => (id: string) => (id === 'source' ? [member] : []))

beforeAll(() => {
  registerEndpoint('/api/profile/me', () => ({ id: 'me', email: 'me@x.dev', role: role.value, displayName: 'Me', avatarKey: null }))
  registerEndpoint('/api/users', () => [{ id: 'user', displayName: 'User', avatarKey: null, role: 'user' }])
  registerEndpoint('/api/channels', () => [
    { id: 'source', type: 'voice', name: 'Source' },
    { id: 'target', type: 'voice', name: 'Target' },
    { id: 'general', type: 'text', name: 'General' },
    { id: 'dm', type: 'dm', otherUserId: 'user', lastActivityAt: 1 },
  ])
  registerEndpoint('/api/admin/voice/move', { method: 'POST', handler: async event => move(await readBody(event)) ?? {} })
})
beforeEach(() => {
  clearNuxtData()
  move.mockReset()
  Object.assign(member, { radioListening: false, cam: false, screen: false })
  useUnread().counts.value = {}
})
afterEach(() => {
  useVoice().channelId.value = null
  vi.restoreAllMocks()
})

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

async function mountSidebar(admin: boolean) {
  role.value = admin ? 'admin' : 'user'
  const wrapper = await mountInApp(AppSidebar)
  await vi.waitFor(() => {
    expect(wrapper.find('[data-member]').exists()).toBe(true)
    expect(useNuxtData<{ role: string }>('me').data.value?.role).toBe(role.value)
  })
  const row = wrapper.find('[data-member]').element as HTMLElement
  const channel = (name: string) => wrapper.findAll('li').find(li => li.find('a').exists() && li.find('a').text() === name)!.element
  const fire = (target: Element, type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  return { row, avatar: row.firstElementChild!, source: channel('Source'), target: channel('Target'), fire }
}

it('highlights unread DM rows and channel pings, keeps badges on the right, and clears on read', async () => {
  const unread = useUnread()
  unread.set('dm', { unread: 3, mentions: 0 })
  unread.set('general', { unread: 4, mentions: 1 })
  const wrapper = await mountInApp(AppSidebar)
  await vi.waitFor(() => expect(wrapper.find('a[href="/c/general"]').exists()).toBe(true))
  const dm = () => wrapper.findAll('button').find(b => b.findAll('[data-slot="label"]').some(label => label.text() === 'User'))!
  const channel = () => wrapper.find('a[href="/c/general"]')
  await vi.waitFor(() => expect(dm()).toBeDefined())
  expect(dm().classes()).toContain('bg-primary/10')
  expect(dm().find('[aria-label="Unread messages"]').text()).toBe('3')
  expect(dm().find('[aria-label="Unread messages"]').classes()).toContain('ml-auto')
  expect(channel().classes()).toContain('bg-primary/10')
  expect(channel().find('[aria-label="Mentions"]').text()).toBe('1')
  expect(channel().find('[aria-label="Mentions"]').classes()).toContain('ml-auto')

  unread.set('general', { unread: 3, mentions: 0 })
  unread.set('dm', { unread: 0, mentions: 0 })
  await nextTick()
  expect(channel().classes()).not.toContain('bg-primary/10')
  expect(channel().classes()).toContain('font-bold')
  expect(dm().classes()).not.toContain('bg-primary/10')
  expect(dm().find('[aria-label="Unread messages"]').exists()).toBe(false)
})

it('shows a non-actionable radio indicator matching the camera control only while listening', async () => {
  member.cam = true
  const wrapper = await mountInApp(AppSidebar)
  await vi.waitFor(() => expect(wrapper.find('[data-member] [aria-label="Watch User\'s camera"]').exists()).toBe(true))
  const indicator = () => wrapper.find('[data-member] [aria-label="Listening to radio"]')
  expect(indicator().exists()).toBe(false)
  member.radioListening = true
  await nextTick()
  expect(indicator().element.tagName).toBe('SPAN')
  const camera = wrapper.find('[data-member] [aria-label="Watch User\'s camera"]')
  expect(indicator().classes()).toEqual(camera.classes().filter(name => name !== 'ml-auto'))
  expect(wrapper.findAllComponents({ name: 'UButton' }).some(button => button.props('icon') === 'i-lucide-radio' && button.props('as') === 'span')).toBe(true)
  expect(indicator().element.hasAttribute('tabindex')).toBe(false)
  member.radioListening = false
  await nextTick()
  expect(indicator().exists()).toBe(false)
})

it('groups camera and screen before radio, soundboard, and leave for the narrow layout', async () => {
  useVoice().channelId.value = 'source'
  const wrapper = await mountInApp(AppSidebar)
  const actions = wrapper.find('[role="group"][aria-label="Voice actions"]')
  const groups = actions.findAll(':scope > [role="group"]')
  expect(groups).toHaveLength(2)
  expect(groups[0]!.findAll('button').map(button => button.attributes('aria-label'))).toEqual([
    'Turn camera on',
    'Camera options',
    'Share screen',
    'Screen share options',
  ])
  expect(groups[1]!.findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Radio settings', 'Radio options', 'Soundboard', 'Leave voice'])
})

describe('voice member dragging', () => {
  it('rejects non-admin child-avatar drags without arming a target or moving', async () => {
    const { avatar, target, fire } = await mountSidebar(false)
    expect(fire(avatar, 'dragstart')).toBe(true)
    expect(fire(target, 'dragover')).toBe(false)
    fire(target, 'drop')
    await settle()
    expect(move).not.toHaveBeenCalled()
  })

  it('allows admin moves, ignores the current channel and checks authority again on drop', async () => {
    const { row, avatar, source, target, fire } = await mountSidebar(true)
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20 } as DOMRect)
    const setDragImage = vi.fn()
    const start = () => {
      const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 25, clientY: 30 })
      Object.defineProperty(event, 'dataTransfer', { value: { setDragImage } })
      avatar.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    start()
    expect(setDragImage).toHaveBeenCalledExactlyOnceWith(row, 15, 10)
    expect(fire(source, 'dragover')).toBe(false)
    expect(fire(target, 'dragover')).toBe(true)
    fire(source, 'drop')
    start()
    fire(target, 'drop')
    await vi.waitFor(() => expect(move).toHaveBeenCalledExactlyOnceWith({ userId: 'user', channelId: 'target' }))
    expect(fire(target, 'dragover')).toBe(false)
    start()
    const me = useNuxtData('me').data
    me.value = { ...(me.value as object), role: 'user' }
    expect(fire(target, 'dragover')).toBe(false)
    fire(target, 'drop')
    await settle()
    expect(move).toHaveBeenCalledTimes(1)
  })
})
