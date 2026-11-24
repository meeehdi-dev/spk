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
    const fields = wrapper.findAll('dl > div')
    expect(fields[0]!.classes()).toContain('col-span-full')
    expect(fields[0]!.find('a').attributes('href')).toBe('https://example.com/x')
    expect(fields[1]!.classes()).toContain('col-span-full')
    expect(fields[2]!.classes()).toContain('col-span-1')
    expect(fields[2]!.find('a').exists()).toBe(false)
  })

  it('renders a plain title without a link', async () => {
    const wrapper = await mountInApp(WebhookEmbed, { embed: { title: 'Hi' } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('[data-embed]').classes()).toContain('border-accented')
  })
})
