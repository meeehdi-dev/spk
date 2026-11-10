import { hashPassword } from 'better-auth/crypto'
import { resetPassword } from '../../db/reset'
import { createLimiter } from '../../utils/limiter'

const allow = createLimiter(10, 60_000)

// Public (the user is signed out): the one-time token is the credential.
export default defineEventHandler(async (event) => {
  if (!allow(getRequestIP(event, { xForwardedFor: true }) ?? 'unknown')) throw createError({ statusCode: 429, statusMessage: 'Too many attempts' })
  const { token, password } = await readBody<{ token?: unknown, password?: unknown }>(event) ?? {}
  if (typeof token !== 'string' || !token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw createError({ statusCode: 400, statusMessage: 'Password must be 8–128 characters' })
  const ok = await asHttp(async () => resetPassword(useDb(), token, await hashPassword(password)))
  if (!ok) throw createError({ statusCode: 410, statusMessage: 'This reset link is invalid, expired or already used' })
  return { ok: true }
})
