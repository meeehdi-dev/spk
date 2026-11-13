import { sweepOrphans } from '../../db/attachments'
import { retryObjectDeletions } from '../../db/objectDeletions'
import { logBackground } from '../../utils/errorLog'

export default defineTask({
  meta: { name: 'attachments:cleanup', description: 'Retry object deletions and delete unsent uploads older than 24 h' },
  async run() {
    const c = useR2()
    try {
      const db = useDb()
      const deleteKey = (key: string) =>
        r2Delete(c, key).catch(e => {
          logBackground('task attachments:cleanup (R2 delete)', e)
          throw e
        })
      const deletions = await retryObjectDeletions(db, deleteKey)
      const orphans = await sweepOrphans(db, deleteKey)
      return { result: { orphans, ...deletions } }
    } catch (e) {
      logBackground('task attachments:cleanup', e)
      throw e
    }
  },
})
