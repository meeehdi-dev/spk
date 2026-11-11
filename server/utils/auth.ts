import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { admin } from 'better-auth/plugins/admin'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { claimInvite, linkInviteUser, releaseInvite } from '../db/invites'

import { logBackground } from './errorLog'

const INVITE_HEADER = 'x-invite-token'

function create() {
  const db = useDb()
  return betterAuth({
    // BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment by better-auth.
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    // Dev only: trust any localhost port (e.g. the Plannotator proxy). Production keeps BETTER_AUTH_URL as the only origin.
    trustedOrigins: import.meta.dev ? ['http://localhost:*', 'http://127.0.0.1:*'] : [],
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { customRules: { '/sign-in/email': { window: 60, max: 5 } } },
    user: { additionalFields: {
      displayName: { type: 'string', required: false, input: false },
      avatarKey: { type: 'string', required: false, input: false }
    } },
    // Failures are logged with their path in server/api/auth/[...all].ts; this adds the stack of unexpected (5xx) ones.
    onAPIError: { onError: (e) => { if (!isAPIError(e) || e.statusCode >= 500) logBackground('auth', e) } },
    databaseHooks: { session: { create: { after: async (s) => { console.info(`[auth] sign-in user=${s.userId} ip=${s.ipAddress ?? '-'}`) } } } },
    plugins: [admin({ defaultRole: 'user' })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') {
          const token = ctx.headers?.get(INVITE_HEADER)
          if (!token || !claimInvite(db, token)) throw new APIError('FORBIDDEN', { message: 'A valid invite is required to sign up' })
        }
        // The app has its own admin routes (role, ban, reset, invites). better-auth's admin endpoints would bypass their rules
        // (last admin, DM privacy via impersonation, invite-only sign-up), so none are reachable.
        if (ctx.path.startsWith('/admin/')) throw new APIError('FORBIDDEN', { message: 'Not available' })
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        const token = ctx.headers?.get(INVITE_HEADER)
        if (!token) return
        const returned = ctx.context.returned as { user?: { id: string } } | Error | undefined
        const userId = returned && !(returned instanceof Error) ? returned.user?.id : undefined
        if (!userId) return releaseInvite(db, token)
        // An invite made by the system at startup (no creator) is the first-admin invite.
        if (linkInviteUser(db, token, userId) === null) {
          db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, userId)).run()
        }
      })
    }
  })
}

let auth: ReturnType<typeof create> | undefined
export const useAuth = () => auth ??= create()
