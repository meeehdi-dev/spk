import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import WebhookDialog from '~/components/WebhookDialog.vue'
import { mountInApp } from '~~/tests/fixtures/app'

const create = vi.fn()
const secret = vi.fn()
let failCreate = false
beforeAll(() => {
  registerEndpoint('/api/profile/me', () => ({ id: 'me', email: 'me@x.dev', role: 'user', displayName: 'Me', avatarKey: null }))
  registerEndpoint('/api/channels', () => [])
  registerEndpoint('/api/webhooks', {
    method: 'POST',
    handler: async event => {
      if (failCreate) throw createError({ statusCode: 500 })
      create(await readBody(event))
      return { channel: { id: 'w1', type: 'webhook', name: 'Deploys' }, url: 'https://spk.test/api/hooks/w1/secret' }
    },
  })
  registerEndpoint('/api/webhooks/w1/secret', {
    method: 'POST',
    handler: () => {
      secret()
      return { url: 'https://spk.test/api/hooks/w1/new' }
    },
  })
})

describe('WebhookDialog', () => {
  it('creates a webhook and shows the URL once', async () => {
    await mountInApp(WebhookDialog)
    useAdmin().webhookDialog.value = { mode: 'create' }
    await vi.waitFor(() => expect(document.body.querySelector('input[maxlength="32"]')).not.toBeNull())
    const input = document.body.querySelector<HTMLInputElement>('input[maxlength="32"]')!
    input.value = 'Deploys'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    await vi.waitFor(() =>
      expect(document.body.querySelector<HTMLInputElement>('input[aria-label="Webhook URL"]')?.value).toBe('https://spk.test/api/hooks/w1/secret'),
    )
    expect(create).toHaveBeenCalledWith({ name: 'Deploys', icon: 'webhook', private: true })
    expect(document.body.textContent).toContain('Shown only once')
    expect(document.body.querySelector('[aria-label="Copy URL"]')).not.toBeNull()
  })

  it('keeps the form open when create fails', async () => {
    failCreate = true
    await mountInApp(WebhookDialog)
    useAdmin().webhookDialog.value = { mode: 'create' }
    await vi.waitFor(() => expect(document.body.querySelector('input[maxlength="32"]')).not.toBeNull())
    const input = document.body.querySelector<HTMLInputElement>('input[maxlength="32"]')!
    input.value = 'Deploys'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    await flushPromises()
    failCreate = false
    expect(useAdmin().webhookDialog.value).not.toBeNull()
    expect(document.body.querySelector<HTMLInputElement>('input[maxlength="32"]')?.value).toBe('Deploys')
  })

  it('asks before generating a new secret URL', async () => {
    await mountInApp(WebhookDialog)
    useAdmin().webhookDialog.value = { mode: 'secret', channel: { id: 'w1', type: 'webhook', name: 'Deploys' } as never }
    await vi.waitFor(() => expect(document.body.textContent).toContain('stops working'))
    expect(secret).not.toHaveBeenCalled()
    const button = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('Generate new URL'))!
    button.click()
    await vi.waitFor(() =>
      expect(document.body.querySelector<HTMLInputElement>('input[aria-label="Webhook URL"]')?.value).toBe('https://spk.test/api/hooks/w1/new'),
    )
    expect(secret).toHaveBeenCalledOnce()
  })
})
