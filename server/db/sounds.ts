import { eq } from 'drizzle-orm'
import type { Db } from './client'
import { sounds } from './schema'
import { ChatError } from './messages'
import { MAX_SOUND_BYTES, MAX_SOUND_MS } from '../../shared/utils/sounds'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const soundKey = (id: string) => `sounds/${id}`

/** Name (1–32 characters) and Lucide icon name, trimmed and checked. */
function cleanSoundMeta(input: { name?: unknown, icon?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''
  if (name.length < 1 || name.length > 32) throw new ChatError(400, 'Name must be 1–32 characters')
  if (typeof input.icon !== 'string' || !/^[a-z0-9-]{1,64}$/.test(input.icon)) throw new ChatError(400, 'Bad icon')
  return { name, icon: input.icon }
}

/** The presign request: only a small WAV may be uploaded. */
export function checkSoundSize(size: unknown) {
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 44) throw new ChatError(400, 'Bad file size')
  if (size > MAX_SOUND_BYTES) throw new ChatError(413, 'Sounds can be 1.5 MB at most')
  return size
}

/** The id must be a UUID that presign handed out; the caller checks the uploaded object (`uploadedSize`) before this runs. */
export function createSound(db: Db, userId: string, input: { id?: unknown, name?: unknown, icon?: unknown, durationMs?: unknown, size?: unknown }, uploadedSize: number | null) {
  const meta = cleanSoundMeta(input)
  const size = checkSoundSize(input.size)
  const d = input.durationMs
  if (typeof input.id !== 'string' || !UUID.test(input.id)) throw new ChatError(400, 'Bad sound id')
  if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > MAX_SOUND_MS + 50) throw new ChatError(400, 'Sounds can be 10 s at most')
  if (uploadedSize !== size) throw new ChatError(400, 'The file was not uploaded')
  if (db.select().from(sounds).where(eq(sounds.id, input.id)).get()) throw new ChatError(409, 'Already saved')
  return db.insert(sounds).values({ id: input.id, ...meta, r2Key: soundKey(input.id), durationMs: d, size, createdBy: userId }).returning().get()
}

export const listSounds = (db: Db) =>
  db.select({ id: sounds.id, name: sounds.name, icon: sounds.icon, durationMs: sounds.durationMs }).from(sounds).orderBy(sounds.name).all()

export const getSound = (db: Db, id: string) => db.select().from(sounds).where(eq(sounds.id, id)).get()

/** Name and icon only (the trim can't change; delete and upload again). */
export function updateSound(db: Db, id: string, input: { name?: unknown, icon?: unknown }) {
  const row = db.update(sounds).set(cleanSoundMeta(input)).where(eq(sounds.id, id)).returning().get()
  if (!row) throw new ChatError(404, 'Not found')
  return row
}

/** Removes the row; returns its R2 key. */
export const deleteSound = (db: Db, id: string) => db.delete(sounds).where(eq(sounds.id, id)).returning({ key: sounds.r2Key }).get()?.key ?? null
