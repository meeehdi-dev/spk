import { createInvite, INVITE_TTL_MS } from '../db/invites'
import { hasUsers, seedChannels } from '../db/seed'

export default defineNitroPlugin(() => {
  const db = useDb() // runs migrations
  seedChannels(db)
  const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
  // Print a fresh first-admin link now and each time the last one expires, until the first user exists.
  const print = () => {
    if (hasUsers(db)) return clearInterval(timer)
    const { token } = createInvite(db, { createdBy: null, note: 'First admin' })
    console.log(`\n[spk] No users yet. First admin invite (valid 5 minutes):\n[spk] ${base}/signup?invite=${token}\n`)
  }
  const timer = setInterval(print, INVITE_TTL_MS)
  timer.unref()
  if (hasUsers(db)) return clearInterval(timer)
  print()
})
