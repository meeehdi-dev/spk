import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import chars from '@iconify-json/twemoji/chars.json'
import collection from '@iconify-json/twemoji/icons.json'
import { version } from '@iconify-json/twemoji/package.json'
import { defineNuxtModule } from 'nuxt/kit'

export async function writeTwemojiAssets(directory: string) {
  await mkdir(directory, { recursive: true })
  for (const [code, name] of Object.entries(chars)) {
    const icon = collection.icons[name as keyof typeof collection.icons]
    const width = 'width' in icon ? icon.width : collection.width
    const height = 'height' in icon ? icon.height : collection.height
    await writeFile(join(directory, `${code}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${icon.body}</svg>`)
  }
}

export default defineNuxtModule({
  meta: { name: 'spk-twemoji' },
  setup(_options, nuxt) {
    const directory = join(nuxt.options.buildDir, 'twemoji', version)
    // The CLI clears buildDir after module setup, before starting the build.
    nuxt.hook('build:before', () => writeTwemojiAssets(directory))
    nuxt.hook('nitro:config', config => {
      config.publicAssets ||= []
      config.publicAssets.push({ dir: directory, baseURL: `/twemoji/${version}`, maxAge: 60 * 60 * 24 * 365 })
      // Nuxt's build directory can live inside .cache, which Nitro otherwise ignores when copying assets.
      config.ignore ||= []
      config.ignore.push(`!${directory}/**/*`)
    })
  },
})
