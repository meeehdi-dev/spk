import { version } from '@iconify-json/twemoji/package.json'

export function twemojiSrc(emoji: string): string {
  const code = Array.from(emoji.replace(/\uFE0F/g, ''))
    .map(char => char.codePointAt(0)!.toString(16).padStart(4, '0'))
    .join('-')
  return `/twemoji/${version}/${code}.svg`
}
