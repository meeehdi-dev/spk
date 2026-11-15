import { UForm } from '#components'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'

import Login from '~/pages/login.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), toast: vi.fn(), refresh: vi.fn(), navigate: vi.fn() }))
mockNuxtImport('authClient', () => ({ signIn: { email: mocks.signIn } }))
mockNuxtImport('useToast', () => () => ({ add: mocks.toast }))
mockNuxtImport('refreshNuxtData', () => mocks.refresh)
mockNuxtImport('navigateTo', () => mocks.navigate)
beforeEach(() => vi.resetAllMocks())

it.each(['returned', 'thrown', 'empty'])('toasts %s sign-in failures without adding form rows and permits retry', async kind => {
  const wrapper = await mountInApp(Login)
  await wrapper.get('input[type="email"]').setValue('me@example.com')
  await wrapper.get('input[type="password"]').setValue('password')
  const error = kind === 'empty' ? {} : { message: 'Invalid credentials' }
  if (kind === 'thrown') mocks.signIn.mockRejectedValueOnce(error)
  else mocks.signIn.mockResolvedValueOnce({ error })
  wrapper.findComponent(UForm).vm.$emit('submit', {})
  await flushPromises()
  expect(mocks.signIn).toHaveBeenCalledWith({ email: 'me@example.com', password: 'password' })
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: kind === 'empty' ? 'Sign-in failed' : 'Invalid credentials', color: 'error' }))
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  expect(mocks.navigate).not.toHaveBeenCalled()

  mocks.signIn.mockResolvedValueOnce({ error: null })
  wrapper.findComponent(UForm).vm.$emit('submit', {})
  await flushPromises()
  expect(mocks.refresh).toHaveBeenCalledWith('me')
  expect(mocks.navigate).toHaveBeenCalledWith('/')
})
