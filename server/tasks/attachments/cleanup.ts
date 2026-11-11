import { sweepOrphans } from '../../db/attachments'

export default defineTask({
  meta: { name: 'attachments:cleanup', description: 'Delete uploads that were never sent in a message (older than 24 h)' },
  async run() {
    const c = useR2()
    try {
      return { result: await sweepOrphans(useDb(), key => r2Delete(c, key).catch((e) => { logBackground('task attachments:cleanup (R2 delete)', e); throw e })) }
    } catch (e) { logBackground('task attachments:cleanup', e); throw e }
  }
})
