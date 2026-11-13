import { describe, expect, it } from 'vitest'

import { isPushEndpoint } from '~~/server/utils/pushEndpoint'
import { invalidEndpoints, validEndpoints } from '~~/tests/fixtures/push'

describe('push endpoint policy', () => {
  it.each(validEndpoints)('accepts %s', endpoint => expect(isPushEndpoint(endpoint)).toBe(true))
  it.each(invalidEndpoints)('rejects %s', endpoint => expect(isPushEndpoint(endpoint)).toBe(false))
})
