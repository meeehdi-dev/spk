import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import AppSidebar from '~/components/AppSidebar.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const role = vi.hoisted(() => ({ value: 'user' }))
const move = vi.fn()
mockNuxtImport('voiceMembers', () => (id: string) => (id === 'source' ? [{ userId: 'user', channelId: 'source' }] : []))

beforeAll(() => {
  registerEndpoint('/api/profile/me', () => ({ id: 'me', email: 'me@x.dev', role: role.value, displayName: 'Me', avatarKey: null }))
  registerEndpoint('/api/users', () => [{ id: 'user', displayName: 'User', avatarKey: null, role: 'user' }])
  registerEndpoint('/api/channels', () => [
    { id: 'source', type: 'voice', name: 'Source' },
    { id: 'target', type: 'voice', name: 'Target' },
  ])
  registerEndpoint('/api/admin/voice/move', { method: 'POST', handler: async event => move(await readBody(event)) ?? {} })
})
beforeEach(() => {
  clearNuxtData()
  move.mockReset()
})
afterEach(() => vi.restoreAllMocks())

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
