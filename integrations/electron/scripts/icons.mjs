// Regenerates integrations/electron/assets. Run from the repo root: node integrations/electron/scripts/icons.mjs
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { cwd } from 'node:process'

const root = cwd()
const require = createRequire(join(root, 'package.json'))
const sharp = require('sharp')
const { icons } = require('@iconify-json/lucide/icons.json')

const out = join(root, 'integrations/electron/assets')
await mkdir(out, { recursive: true })

const render = async (svg, name) => {
  for (const [suffix, size] of [
    ['', 16],
    ['@2x', 32],
  ]) {
    await sharp(Buffer.from(svg), { density: (72 * size * 4) / 24 })
      .resize(size, size)
      .png()
      .toFile(join(out, `${name}${suffix}.png`))
  }
}

for (const name of ['mic', 'mic-off', 'headphones', 'headphone-off', 'phone-off']) {
  const { body } = icons[name]
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
    name,
  )
}

await render(await readFile(join(root, 'public/logo.svg'), 'utf8'), 'tray')
