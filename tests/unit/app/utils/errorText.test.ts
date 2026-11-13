import { describe, expect, it } from 'vitest'

import { errorText } from '~/utils/errorText'

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
