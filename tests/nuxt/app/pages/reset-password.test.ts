import { UForm } from '#components'
import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { beforeEach, expect, it, vi } from 'vitest'

import ResetPassword from '~/pages/reset-password.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const mocks = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn(), valid: true }))
mockNuxtImport('useToast', () => () => ({ add: mocks.toast }))
mockNuxtImport('useRoute', () => () => ({ query: { token: 'reset' } }))
registerEndpoint('/api/reset-password/check', () => ({ valid: mocks.valid }))
registerEndpoint('/api/reset-password', { method: 'POST', handler: async event => mocks.save(await readBody(event)) ?? {} })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.valid = true
})

it('toasts a submission failure without adding form rows, then preserves the success screen on retry', async () => {
  const wrapper = await mountInApp(ResetPassword)
  await wrapper.get('input').setValue('new-password')
  mocks.save.mockReturnValueOnce(
    new Response(JSON.stringify({ message: 'Reset unavailable' }), { status: 400, headers: { 'content-type': 'application/json' } }),
  )
  wrapper.findComponent(UForm).vm.$emit('submit', {})
  await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reset unavailable', color: 'error' })))
  await flushPromises()
  expect(mocks.save).toHaveBeenCalledWith({ token: 'reset', password: 'new-password' })
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  expect(wrapper.get('input').attributes('minlength')).toBe('8')

  wrapper.findComponent(UForm).vm.$emit('submit', {})
  await vi.waitFor(() => expect(wrapper.text()).toContain('Password changed'))
  expect(wrapper.text()).toContain('You were signed out everywhere')
  expect(wrapper.find('form').exists()).toBe(false)
  expect(wrapper.get('a').attributes('href')).toBe('/login')
})

it('keeps invalid reset links persistent and hides the form', async () => {
  mocks.valid = false
  const wrapper = await mountInApp(ResetPassword)
  expect(wrapper.text()).toContain('This reset link is invalid, expired or already used')
  expect(wrapper.find('form').exists()).toBe(false)
  expect(mocks.toast).not.toHaveBeenCalled()
})
