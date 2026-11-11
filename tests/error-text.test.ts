import { describe, expect, it, vi } from 'vitest'

import { errorText } from '../app/utils/errorText'
import { ChatError } from '../server/db/messages'
import { asHttp } from '../server/utils/http'

describe('errorText', () => {
  it('prefers the JSON body message, intact', () => {
    expect(errorText({ data: { message: 'Name must be 1–32 characters' }, message: 'x' }, 'f')).toBe('Name must be 1–32 characters')
  })
  it('falls back to the error message, then the fallback', () => {
    expect(errorText({ message: 'Network down' }, 'f')).toBe('Network down')
    expect(errorText({}, 'f')).toBe('f')
    expect(errorText(null)).toBe('')
  })
})

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
