import { resetPassword } from '../../db/reset'
import { createLimiter } from '../../utils/limiter'

const allow = createLimiter(10, 60_000)

// shortcut: socket peer address, so behind a proxy this is one shared bucket; per-client once proxy IP config (G1-05) lands.
// Public (the user is signed out): the one-time token is the credential.
export default defineEventHandler(async (event) => {
  if (!allow(getRequestIP(event) ?? 'unknown')) throw createError({ statusCode: 429, statusMessage: 'Too many attempts' })
  const { token, password } = await readBody<{ token?: unknown, password?: unknown }>(event) ?? {}
  if (typeof token !== 'string' || !token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  const { hash, config: { minPasswordLength: min, maxPasswordLength: max } } = (await useAuth().$context).password
  if (typeof password !== 'string' || password.length < min || password.length > max) throw createError({ statusCode: 400, statusMessage: `Password must be ${min}–${max} characters` })
  const userId = await asHttp(async () => resetPassword(useDb(), token, await hash(password)))
  if (!userId) throw createError({ statusCode: 410, statusMessage: 'This reset link is invalid, expired or already used' })
  console.info(`[auth] password reset user=${userId}`)
  for (const p of [...peersOf(userId)]) p.close(4001, 'signed out') // their sessions are gone
  return { ok: true }
})
