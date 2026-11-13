import { describe, expect, it } from 'vitest'

import { activeFilter, parseSearch } from '#shared/utils/searchQuery'

describe('parseSearch', () => {
  it('splits words and filters', () => {
    const p = parseSearch('hello from:Alex mentions:@Bo in:#general has:file has:IMAGE has:link before:2026-11-01 after:2026-10-01 world')
    expect(p.terms).toEqual(['hello', 'world'])
    expect(p.from).toEqual(['Alex'])
    expect(p.mentions).toEqual(['Bo'])
    expect(p.in).toEqual(['general'])
    expect(p.has).toEqual(['file', 'image', 'link'])
    expect(p.before).toBe(Date.parse('2026-11-01T00:00:00Z'))
    expect(p.after).toBe(Date.parse('2026-10-02T00:00:00Z')) // after = from the next day on
  })
  it('quoted values, unfinished and invalid filters', () => {
    expect(parseSearch('from:"Al Ex"').from).toEqual(['Al Ex'])
    expect(parseSearch('from:').from).toEqual([])
    expect(parseSearch('has:cat').terms).toEqual(['has:cat'])
    expect(parseSearch('before:2026-13-45').before).toBeUndefined()
    expect(parseSearch('foo:bar').terms).toEqual(['foo:bar'])
    expect(parseSearch('"two words"').terms).toEqual(['two', 'words'])
    expect(parseSearch('AND OR "').terms).toEqual(['AND', 'OR'])
  })
})

describe('activeFilter', () => {
  it('finds the autocomplete target', () => {
    expect(activeFilter('hi from:Al')).toMatchObject({ key: 'from', value: 'Al' })
    expect(activeFilter('hi from:Al ')).toBeNull()
  })
})
