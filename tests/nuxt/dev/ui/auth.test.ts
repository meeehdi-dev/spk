import { expect, it, vi } from 'vitest'

import { authClient } from '~~/dev/ui/auth'

it('returns a local session and rejects credential changes without creating real auth requests', async () => {
  const network = vi.fn()
  vi.stubGlobal('fetch', network)
  try {
    expect(await authClient.getSession()).toMatchObject({ data: { user: { id: 'ui-me' } }, error: null })
    for (const result of [
      await authClient.changePassword({ newPassword: 'unused' }),
      await authClient.signIn.email({ email: 'unused@example.test' }),
      await authClient.signUp.email({ email: 'unused@example.test' }),
      await authClient.signOut(),
    ])
      expect(result).toMatchObject({ data: null, error: { status: 501 } })
    expect(network).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
