export function pingChart(history: { time: number; ping: number | null }[], end: number, ceiling?: number) {
  const start = end - 60_000
  const first = history.findLastIndex(point => point.time < start)
  const points = history.slice(Math.max(0, first))
  const values = points.flatMap(point => (point.time >= start && point.time <= end && point.ping !== null ? [point.ping] : []))
  const max = ceiling ?? Math.max(100, ...points.flatMap(point => (point.ping === null ? [] : [point.ping])))
  let path = ''
  let previous: { x: number; y: number; time: number } | undefined
  for (const point of points) {
    if (point.ping === null) {
      previous = undefined
      continue
    }
    const x = 2 + ((point.time - start) / 60_000) * 276
    const y = 62 - (point.ping / max) * 56
    if (!previous || point.time - previous.time > 5000) {
      // A short segment makes a single sample visible too.
      path += `M${x},${y} L${x + 0.1},${y} `
    } else {
      const middle = (previous.x + x) / 2
      path += `C${middle},${previous.y} ${middle},${y} ${x},${y} `
    }
    previous = { x, y, time: point.time }
  }
  return {
    path,
    max,
    summary: values.length
      ? `Signaling ping over the last 60 seconds: ${Math.min(...values)} to ${Math.max(...values)} milliseconds.`
      : 'No ping samples available yet.',
  }
}
