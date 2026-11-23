import type { MessageDto } from '~~/server/db/messages'

import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { beforeEach, expect, it, vi } from 'vitest'

import PollComposer from '~/components/chat/PollComposer.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const mocks = vi.hoisted(() => ({ send: vi.fn(() => true) }))
mockNuxtImport('useSocket', () => () => ({ send: mocks.send }))

const patch = vi.fn()
registerEndpoint('/api/messages/m1', { method: 'PATCH', handler: async event => (patch(await readBody(event)), {}) })

const message = (votes: string[]): MessageDto =>
  ({
    id: 'm1',
    channelId: 'c',
    body: 'Lunch?',
    poll: {
      options: [
        { id: 'o1', label: 'Pizza', userIds: votes },
        { id: 'o2', label: 'Sushi', userIds: [] },
      ],
    },
  }) as MessageDto

const body = () => document.body
const input = (label: string) => body().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const submit = () => body().querySelector<HTMLButtonElement>('button[type="submit"]')!
const type = async (el: HTMLInputElement, v: string) => {
  el.value = v
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}
const button = (text: string) => [...body().querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const mount = async (m?: MessageDto) => {
  await mountInApp(PollComposer, { channelId: 'c', message: m, open: true })
  await flushPromises()
}

beforeEach(() => {
  mocks.send.mockClear()
  patch.mockReset()
  document.body.innerHTML = ''
})

it('disables submit until the poll is valid', async () => {
  await mount()
  expect(submit().disabled).toBe(true)
  await type(body().querySelector<HTMLInputElement>('input')!, 'Q?')
  await type(input('Option 1'), 'A')
  await type(input('Option 2'), 'a')
  expect(submit().disabled).toBe(true) // duplicate, case-insensitive
  await type(input('Option 2'), 'B')
  expect(submit().disabled).toBe(false)
})

it('sends a message:send frame when creating', async () => {
  await mount()
  await type(body().querySelector<HTMLInputElement>('input')!, ' Q? ')
  await type(input('Option 1'), 'A')
  await type(input('Option 2'), 'B')
  submit().click()
  await flushPromises()
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'message:send', channelId: 'c', body: 'Q?', poll: [{ label: 'A' }, { label: 'B' }], nonce: expect.any(String) }),
  )
})

it('saves directly when nobody voted', async () => {
  await mount(message([]))
  await type(input('Option 2'), 'Ramen')
  submit().click()
  await flushPromises()
  expect(patch).toHaveBeenCalledWith({
    body: 'Lunch?',
    poll: [
      { id: 'o1', label: 'Pizza' },
      { id: 'o2', label: 'Ramen' },
    ],
    resetVotes: false,
  })
})

it('saves a question-only change without confirming, even with votes', async () => {
  await mount(message(['u']))
  await type(body().querySelector<HTMLInputElement>('input')!, 'Dinner?')
  submit().click()
  await flushPromises()
  expect(body().textContent).not.toContain('People have already voted')
  expect(patch).toHaveBeenCalledOnce()
})

it.each([
  ['Keep votes', false],
  ['Reset votes', true],
])('%s resolves the confirm with resetVotes %s', async (label, reset) => {
  await mount(message(['u']))
  await type(input('Option 2'), 'Ramen')
  submit().click()
  await flushPromises()
  expect(body().textContent).toContain('People have already voted. What should happen to their votes?')
  expect(patch).not.toHaveBeenCalled()
  button(label).click()
  await flushPromises()
  expect(patch).toHaveBeenCalledWith(expect.objectContaining({ resetVotes: reset }))
})
