import { describe, expect, it } from 'vitest'

import { pingChart } from '~/utils/ping-chart'

describe('pingChart', () => {
  it('curves between samples using controls bounded by their endpoint values', () => {
    const chart = pingChart(
      [
        { time: 58_000, ping: 0 },
        { time: 60_000, ping: 100 },
      ],
      60_000,
    )
    expect(chart.path).toContain('C273.4,62 273.4,6 278,6')
    expect(chart.max).toBe(100)
    expect(chart.summary).toContain('0 to 100')
  })

  it('uses the animated ceiling to rescale samples without changing measurements', () => {
    const chart = pingChart([{ time: 60_000, ping: 100 }], 60_000, 200)
    expect(chart.path).toContain('M278,34')
    expect(chart.max).toBe(200)
    expect(chart.summary).toContain('100 to 100')
  })

  it('retains a segment across the left clipping boundary and moves it continuously', () => {
    const history = [
      { time: -4000, ping: 20 },
      { time: -1000, ping: 40 },
      { time: 1000, ping: 50 },
    ]
    const before = pingChart(history, 60_000)
    const after = pingChart(history, 60_100)
    expect(Number(before.path.slice(1).split(',')[0])).toBeCloseTo(-2.6)
    expect(before.path).toContain('C')
    expect(after.path).not.toBe(before.path)
    expect(before.summary).toContain('50 to 50')
  })

  it('breaks the line for missing readings and long sampling gaps', () => {
    const chart = pingChart(
      [
        { time: 1000, ping: 20 },
        { time: 2000, ping: null },
        { time: 3000, ping: 40 },
        { time: 9000, ping: 50 },
      ],
      10_000,
    )
    expect(chart.path.match(/M/g)).toHaveLength(3)
    expect(chart.path).not.toContain('C')
  })

  it('handles empty and expired history without reporting stale values', () => {
    expect(pingChart([], 60_000)).toMatchObject({ path: '', max: 100, summary: 'No ping samples available yet.' })
    expect(pingChart([{ time: 0, ping: 42 }], 70_000).summary).toBe('No ping samples available yet.')
  })
})
