import type { GifItem } from '../../shared/utils/gifs'

import type { Db } from './client'

import { and, asc, eq } from 'drizzle-orm'

import { gifFavorites } from './schema'

export function listGifFavorites(db: Pick<Db, 'select'>, userId: string): GifItem[] {
  return db
    .select({
      id: gifFavorites.gifId,
      title: gifFavorites.title,
      url: gifFavorites.url,
      preview: gifFavorites.preview,
      width: gifFavorites.width,
      height: gifFavorites.height,
    })
    .from(gifFavorites)
    .where(eq(gifFavorites.userId, userId))
    .orderBy(asc(gifFavorites.title), asc(gifFavorites.gifId))
    .all()
}

export function saveGifFavorite(db: Db, userId: string, gif: GifItem) {
  return db.transaction(tx => {
    const favorites = listGifFavorites(tx, userId)
    if (favorites.some(f => f.id === gif.id)) return true
    if (favorites.length >= 50) return false
    const { id, ...metadata } = gif
    tx.insert(gifFavorites)
      .values({ userId, gifId: id, ...metadata })
      .onConflictDoNothing()
      .run()
    return true
  })
}

export function removeGifFavorite(db: Db, userId: string, gifId: string) {
  db.delete(gifFavorites)
    .where(and(eq(gifFavorites.userId, userId), eq(gifFavorites.gifId, gifId)))
    .run()
}
