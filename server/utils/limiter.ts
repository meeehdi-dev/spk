/** Sliding-window limiter: at most `max` hits per `windowMs` per key. */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (key: string, now = Date.now()) => {
    // Drop keys whose window is empty so idle clients don't accumulate (cost: one pass over active keys per call).
    for (const [k, ts] of hits) if (now - ts[ts.length - 1]! >= windowMs) hits.delete(k)
    const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      return false
    }
    recent.push(now)
    hits.set(key, recent)
    return true
  }
}
