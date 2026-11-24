import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import WebhookEmbed from '~/components/chat/WebhookEmbed.vue'
import { mountInApp } from '~~/tests/fixtures/app'

describe('WebhookEmbed', () => {
  it('renders colour, linked title, description, fields and footer', async () => {
    const wrapper = await mountInApp(WebhookEmbed, {
      embed: {
        title: 'Deploy',
        url: 'https://example.com/d',
        color: 'success',
        description: 'All **good**',
        fields: [
          { name: 'Env', value: 'prod', inline: true },
          { name: 'Notes', value: 'none' },
        ],
        footer: 'Coolify',
        timestamp: new Date().toISOString(),
      },
    })
    await flushPromises()
    expect(wrapper.find('[data-embed]').classes()).toContain('border-success')
    expect(wrapper.find('a').attributes('href')).toBe('https://example.com/d')
    await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('good'))
    const fields = wrapper.findAll('dl > div')
    expect(fields[0]!.classes()).toContain('col-span-1')
    expect(fields[1]!.classes()).toContain('col-span-full')
    expect(wrapper.text()).toContain('Coolify · just now')
  })

  it('gives long or URL inline fields a full row and links URLs', async () => {
    const wrapper = await mountInApp(WebhookEmbed, {
      embed: {
        fields: [
          { name: 'url', value: 'https://example.com/x', inline: true },
          { name: 'uuid', value: 'x'.repeat(41), inline: true },
          { name: 'bad', value: 'javascript:alert(1)', inline: true },
        ],
      },
    })
    await flushPromises()
    const fields = wrapper.findAll('dl > div')
    expect(fields[0]!.classes()).toContain('col-span-full')
    await vi.waitFor(() => expect(fields[0]!.find('a').attributes('href')).toBe('https://example.com/x'))
    expect(fields[1]!.classes()).toContain('col-span-full')
    expect(fields[2]!.classes()).toContain('col-span-1')
    expect(fields[2]!.find('a').exists()).toBe(false)
  })

  it('renders markdown field values and sizes them by visible text', async () => {
    const wrapper = await mountInApp(WebhookEmbed, {
      embed: { fields: [{ name: 'Commit', value: `[\`abc1234\`](https://github.com/me/spk/commit/${'a'.repeat(40)})`, inline: true }] },
    })
    await flushPromises()
    const field = wrapper.find('dl > div')
    expect(field.classes()).toContain('col-span-1')
    await vi.waitFor(() => expect(field.find('a code').text()).toBe('abc1234'))
  })

  it('renders the author with a no-referrer avatar', async () => {
    const wrapper = await mountInApp(WebhookEmbed, { embed: { author: { name: 'bob', url: 'https://github.com/bob', icon: 'https://avatars.example/bob' } } })
    const author = wrapper.find('[data-embed-author]')
    expect(author.find('a').attributes('href')).toBe('https://github.com/bob')
    expect(author.find('img').attributes('referrerpolicy')).toBe('no-referrer')
    await author.find('img').trigger('error')
    expect(author.find('img').exists()).toBe(false)
    expect(author.text()).toBe('bob')
  })

  it('renders an author without icon or link as plain text', async () => {
    const wrapper = await mountInApp(WebhookEmbed, { embed: { author: { name: 'bot' } } })
    expect(wrapper.find('[data-embed-author] img').exists()).toBe(false)
    expect(wrapper.find('[data-embed-author] a').exists()).toBe(false)
  })

  it('renders a plain title without a link', async () => {
    const wrapper = await mountInApp(WebhookEmbed, { embed: { title: 'Hi' } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('[data-embed]').classes()).toContain('border-accented')
  })
})
