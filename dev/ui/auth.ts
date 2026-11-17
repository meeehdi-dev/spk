import { defineNuxtRouteMiddleware, navigateTo } from '#imports'

import { resetScenario, sandboxApi } from './fixtures'

const unavailable = async (..._args: unknown[]) => ({ data: null, error: { message: 'Authentication changes are disabled in the UI sandbox', status: 501 } })

// Better Auth captures native fetch before plugin setup, so sandbox config must alias the client too.
export const authClient = {
  getSession: async (..._args: unknown[]) => ({ data: sandboxApi(new URL('http://sandbox.local/api/auth/get-session')), error: null }),
  changePassword: unavailable,
  signIn: { email: unavailable },
  signUp: { email: unavailable },
  signOut: unavailable,
}

export async function signOut() {
  resetScenario()
  await navigateTo('/c/ui-general')
}

// Registered only by the explicit development sandbox config, never production.
export default defineNuxtRouteMiddleware(() => {})
