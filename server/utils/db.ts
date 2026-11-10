import { createDb, type Db } from '../db/client'

let db: Db | undefined

export function useDb() {
  return db ??= createDb(useRuntimeConfig().databasePath)
}
