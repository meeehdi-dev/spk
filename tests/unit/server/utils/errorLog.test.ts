import { afterEach, describe, expect, it, vi } from 'vitest'

import { logFailure, safePath } from '~~/server/utils/errorLog'

describe('safePath', () => {
  it('drops the query string and fragment (tokens)', () => {
    expect(safePath('/signup?invite=SECRET')).toBe('/signup')
    expect(safePath('/api/reset-password/check?token=SECRET#x')).toBe('/api/reset-password/check')
  })
  it('drops scheme and host of a full URL', () => {
    expect(safePath('http://localhost:3000/_ws?a=b')).toBe('/_ws')
  })
  it('falls back to /', () => {
    expect(safePath(undefined)).toBe('/')
    expect(safePath('?token=SECRET')).toBe('/')
  })
})

describe('logFailure', () => {
  afterEach(() => vi.restoreAllMocks())
  it('logs one line without the query; stack only for 5xx', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logFailure({ method: 'POST', url: '/api/x?token=SECRET', status: 400, message: 'bad', userId: 'u1', error: new Error('e') })
    expect(err).toHaveBeenCalledTimes(1)
    expect(err.mock.calls[0]![0]).toBe('[error] POST /api/x 400 bad user=u1')
    logFailure({ method: 'GET', url: '/api/y', status: 500, message: 'boom', error: new Error('e') })
    expect(err).toHaveBeenCalledTimes(3)
  })
})
