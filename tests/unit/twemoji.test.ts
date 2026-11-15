import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import chars from '@iconify-json/twemoji/chars.json'
import { expect, it } from 'vitest'

import { writeTwemojiAssets } from '../../modules/twemoji'

it('generates a local SVG for every Unicode emoji in the pinned artwork collection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spk-twemoji-'))
  try {
    await writeTwemojiAssets(directory)
    expect(await readdir(directory)).toHaveLength(Object.keys(chars).length)
    for (const code of ['1f600', '1f44d-1f3fd', '1f1eb-1f1f7', '2764', '0031-20e3', '1f469-1f3fd-200d-1f4bb', '1f3f4-e0067-e0062-e0065-e006e-e0067-e007f']) {
      const svg = await readFile(join(directory, `${code}.svg`), 'utf8')
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">')
      expect(svg).toContain('<path')
      expect(svg.endsWith('</svg>')).toBe(true)
    }
    expect(await readFile(join(directory, '1f349.svg'), 'utf8')).toContain('viewBox="0 0 36 25.22"')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
