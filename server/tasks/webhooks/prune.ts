import { pruneWebhookMessages } from '../../db/webhooks'
import { logBackground } from '../../utils/errorLog'

export default defineTask({
  meta: { name: 'webhooks:prune', description: 'Delete webhook feed messages older than 30 days' },
  run() {
    try {
      return { result: { deleted: pruneWebhookMessages(useDb()) } }
    } catch (e) {
      logBackground('task webhooks:prune', e)
      throw e
    }
  },
})
