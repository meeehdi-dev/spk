import { describe, expect, it, vi } from 'vitest'

import { routeMediaOutput } from '~/utils/media-output'

describe('media element routing', () => {
  it('changes only the sink, preserving playback state and volume', async () => {
    const element = { setSinkId: vi.fn(async (_id: string) => {}), currentTime: 12, volume: 0.3, paused: false } as unknown as HTMLMediaElement
    await routeMediaOutput(element, 'media')
    await routeMediaOutput(element, '')
    expect(element.setSinkId).toHaveBeenLastCalledWith('')
    expect(element).toMatchObject({ currentTime: 12, volume: 0.3, paused: false })
  })

  it('falls back to default when a device is unavailable or denied, without rejecting', async () => {
    const setSinkId = vi.fn(async (_id: string) => {
      throw new Error('Denied')
    })
    await expect(routeMediaOutput({ setSinkId } as unknown as HTMLMediaElement, 'missing')).resolves.toBeUndefined()
    expect(setSinkId.mock.calls).toEqual([['missing'], ['']])
  })

  it('keeps unsupported elements on their default output', async () => {
    await expect(routeMediaOutput({} as HTMLMediaElement, 'media')).resolves.toBeUndefined()
  })

  it.each([false, true])('restores the latest sink after an older switch settles last (rejected: %s)', async rejected => {
    let settle!: () => void
    let sink = ''
    const setSinkId = vi.fn(async (id: string) => {
      if (id === 'old') {
        await new Promise<void>((resolve, reject) => {
          settle = () => (rejected ? reject(new Error('Device gone')) : resolve())
        })
      }
      sink = id
    })
    const element = { setSinkId } as unknown as HTMLMediaElement
    const old = routeMediaOutput(element, 'old')
    await routeMediaOutput(element, 'latest')
    settle()
    await old
    expect(sink).toBe('latest')
    expect(setSinkId).toHaveBeenLastCalledWith('latest')
    expect(setSinkId).not.toHaveBeenCalledWith('')
  })
})
