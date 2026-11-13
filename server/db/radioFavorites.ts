import type { RadioStation } from '../../shared/utils/radio'

import type { Db } from './client'

import { and, asc, eq } from 'drizzle-orm'

import { radioFavorites } from './schema'

export function listRadioFavorites(db: Pick<Db, 'select'>, userId: string) {
  return db
    .select({ id: radioFavorites.stationId, name: radioFavorites.name, country: radioFavorites.country, codec: radioFavorites.codec })
    .from(radioFavorites)
    .where(eq(radioFavorites.userId, userId))
    .orderBy(asc(radioFavorites.name), asc(radioFavorites.stationId))
    .all()
}

export function saveRadioFavorite(db: Db, userId: string, station: RadioStation) {
  return db.transaction(tx => {
    const favorites = listRadioFavorites(tx, userId)
    if (favorites.some(f => f.id === station.id)) return true
    if (favorites.length >= 50) return false
    tx.insert(radioFavorites)
      .values({ userId, stationId: station.id, name: station.name, country: station.country, codec: station.codec })
      .onConflictDoNothing()
      .run()
    return true
  })
}

export function removeRadioFavorite(db: Db, userId: string, stationId: string) {
  db.delete(radioFavorites)
    .where(and(eq(radioFavorites.userId, userId), eq(radioFavorites.stationId, stationId)))
    .run()
}
