import { ChatError } from '../db/messages'

/** Runs a handler body and turns a ChatError into the matching HTTP error. */
export async function asHttp<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
}
