import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

import DefaultLayout from '~/layouts/default.vue'

mockNuxtImport('useUnreadLive', () => () => {})
mockNuxtImport('useDraftsLive', () => () => {})
mockNuxtImport('useMediaAudioLive', () => () => {})
mockNuxtImport('useIncomingNotifications', () => () => {})
mockNuxtImport('useVoiceLive', () => () => {})
mockNuxtImport('useRadioLive', () => () => {})
mockNuxtImport('useRadioDirectoryLive', () => () => {})
mockNuxtImport('usePresenceLive', () => () => {})
mockNuxtImport('usePushSync', () => () => {})
mockNuxtImport('useAdminLive', () => () => {})

beforeAll(() => {
  registerEndpoint('/api/profile/me', () => ({ id: 'me', displayName: 'Me', role: 'user' }))
  registerEndpoint('/api/users', () => [{ id: 'alex', displayName: 'Alex', role: 'user', avatarKey: null }])
  registerEndpoint('/api/channels', () => [
    { id: 'text', type: 'text', name: 'general' },
    { id: 'voice', type: 'voice', name: 'Lounge' },
    { id: 'dm', type: 'dm', otherUserId: 'alex' },
  ])
})

beforeEach(() => {
  clearNuxtData()
  useUnread().counts.value = {}
})

it('follows the current text channel, voice channel and DM, and updates the total unread badge', async () => {
  const wrapper = await mountSuspended(DefaultLayout, { route: '/c/text', shallow: true })
  const router = useRouter()
  const unread = useUnread()
  await vi.waitFor(() => expect(document.title).toBe('general | spk'))
  const unreadMetadata = () => document.querySelector('meta[name="spk-unread"]')?.getAttribute('content')
  await vi.waitFor(() => expect(unreadMetadata()).toBe('0'))

  unread.set('text', { unread: 2, mentions: 1 })
  unread.set('dm', { unread: 3, mentions: 0 })
  await vi.waitFor(() => expect(document.title).toBe('general (5) | spk'))
  await vi.waitFor(() => expect(unreadMetadata()).toBe('5'))

  await router.push('/c/voice')
  await vi.waitFor(() => expect(document.title).toBe('Lounge (5) | spk'))
  await router.push('/c/dm')
  await vi.waitFor(() => expect(document.title).toBe('@Alex (5) | spk'))

  useNuxtData<{ id: string; displayName: string }[]>('users').data.value = [{ id: 'alex', displayName: 'Alexandra' }]
  await vi.waitFor(() => expect(document.title).toBe('@Alexandra (5) | spk'))

  unread.set('text', { unread: 0, mentions: 0 })
  unread.set('dm', { unread: 0, mentions: 0 })
  await vi.waitFor(() => expect(document.title).toBe('@Alexandra | spk'))
  await vi.waitFor(() => expect(unreadMetadata()).toBe('0'))

  await router.push('/c/missing')
  await vi.waitFor(() => expect(document.title).toBe('spk'))
  wrapper.unmount()
  await vi.waitFor(() => expect(unreadMetadata()).toBeUndefined())
})
