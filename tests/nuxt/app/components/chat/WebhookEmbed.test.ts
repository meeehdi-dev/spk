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
    expect(fields[1]!.classes()).toContain('col-span-3')
    expect(wrapper.text()).toContain('Coolify · just now')
  })

  it('renders a plain title without a link', async () => {
    const wrapper = await mountInApp(WebhookEmbed, { embed: { title: 'Hi' } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('[data-embed]').classes()).toContain('border-accented')
  })
})
