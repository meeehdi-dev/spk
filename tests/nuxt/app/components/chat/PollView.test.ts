import type { PollDto } from '~~/server/db/messages'

import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import PollView from '~/components/chat/PollView.vue'
import { chatActionsKey } from '~/composables/messageContext'
import { mountInApp } from '~~/tests/fixtures/app'

const vote = vi.fn()
const poll: PollDto = {
  options: [
    { id: 'o1', label: 'Yes', userIds: ['a', 'b', 'c'] },
    { id: 'o2', label: 'No', userIds: ['d', 'e'] },
  ],
}

beforeAll(() => {
  registerEndpoint('/api/profile/me', () => ({ id: 'a', email: 'a@x.dev', role: 'user', displayName: 'Alex', avatarKey: null }))
})

async function mountPoll(p: PollDto) {
  const wrapper = await mountInApp(PollView, { messageId: 'm1', poll: p }, { global: { provide: { [chatActionsKey as symbol]: { vote } } } })
  await flushPromises()
  return wrapper
}

describe('PollView', () => {
  it('shows counts, percentages and the total', async () => {
    const buttons = (await mountPoll(poll)).findAll('button')
    expect(buttons[0]!.text()).toContain('3 · 60%')
    expect(buttons[0]!.attributes('aria-label')).toBe('Yes, 3 votes, 60%')
    expect(buttons[1]!.text()).toContain('2 · 40%')
  })

  it('shows zero percent with no votes and singular total', async () => {
    const empty = await mountPoll({ options: [{ id: 'o1', label: 'Yes', userIds: [] }] })
    expect(empty.find('button').text()).toContain('0 · 0%')
    expect(empty.text()).toContain('0 votes')
    const one = await mountPoll({ options: [{ id: 'o1', label: 'Yes', userIds: ['b'] }] })
    expect(one.text()).toContain('1 vote')
    expect(one.text()).not.toContain('1 votes')
  })

  it('marks the own vote and toggles it', async () => {
    const buttons = (await mountPoll(poll)).findAll('button')
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('false')
    await buttons[1]!.trigger('click')
    expect(vote).toHaveBeenLastCalledWith('m1', 'o2')
    await buttons[0]!.trigger('click')
    expect(vote).toHaveBeenLastCalledWith('m1', null)
  })
})
