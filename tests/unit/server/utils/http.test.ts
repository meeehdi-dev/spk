import { describe, expect, it, vi } from 'vitest'

import { ChatError } from '~~/server/db/messages'
import { asHttp } from '~~/server/utils/http'

describe('asHttp', () => {
  it('maps a ChatError into message, non-ASCII intact', async () => {
    vi.stubGlobal('createError', (o: unknown) => o)
    await expect(
      asHttp(() => {
        throw new ChatError(409, 'Name must be 1–32 characters')
      }),
    ).rejects.toEqual({ statusCode: 409, message: 'Name must be 1–32 characters' })
    vi.unstubAllGlobals()
  })
})
