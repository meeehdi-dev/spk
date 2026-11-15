import { UForm } from '#components'
import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'

import Signup from '~/pages/signup.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const mocks = vi.hoisted(() => ({ signUp: vi.fn(), toast: vi.fn(), refresh: vi.fn(), navigate: vi.fn(), token: 'invite', valid: true }))
mockNuxtImport('authClient', () => ({ signUp: { email: mocks.signUp } }))
mockNuxtImport('useToast', () => () => ({ add: mocks.toast }))
mockNuxtImport('refreshNuxtData', () => mocks.refresh)
mockNuxtImport('navigateTo', () => mocks.navigate)
mockNuxtImport('useRoute', () => () => ({ query: { invite: mocks.token } }))
registerEndpoint('/api/invites/check', () => ({ valid: mocks.valid, reason: 'expired' }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.token = 'invite'
  mocks.valid = true
})

it.each(['returned', 'thrown', 'empty'])('toasts %s sign-up failures without adding form rows and permits retry', async kind => {
  const wrapper = await mountInApp(Signup)
  await wrapper.get('input[type="email"]').setValue('me@example.com')
  await wrapper.get('input[type="password"]').setValue('password')
  const error = kind === 'empty' ? {} : { message: 'Sign-up unavailable' }
  if (kind === 'thrown') mocks.signUp.mockRejectedValueOnce(error)
  else mocks.signUp.mockResolvedValueOnce({ error })
  wrapper.findComponent(UForm).vm.$emit('submit', {})
  await flushPromises()
  expect(mocks.signUp).toHaveBeenCalledWith({ email: 'me@example.com', password: 'password', name: 'me' }, { headers: { 'x-invite-token': 'invite' } })
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: kind === 'empty' ? 'Sign-up failed' : 'Sign-up unavailable', color: 'error' }))
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  expect(mocks.navigate).not.toHaveBeenCalled()

  mocks.signUp.mockResolvedValueOnce({ error: null })
  wrapper.findComponent(UForm).vm.$emit('submit', {})
  await flushPromises()
  expect(mocks.refresh).toHaveBeenCalledWith('me')
  expect(mocks.navigate).toHaveBeenCalledWith('/')
})

it.each(['missing', 'expired'])('keeps %s invite states persistent and hides the form', async kind => {
  mocks.token = kind === 'missing' ? '' : 'invite'
  mocks.valid = false
  const wrapper = await mountInApp(Signup)
  expect(wrapper.text()).toContain(kind === 'missing' ? 'You need an invite link' : 'This invite is expired')
  expect(wrapper.find('form').exists()).toBe(false)
  expect(mocks.toast).not.toHaveBeenCalled()
})
