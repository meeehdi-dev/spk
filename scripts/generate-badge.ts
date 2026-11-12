import sharp from 'sharp'

await sharp('public/badge.svg').resize(64, 64).png().toFile('public/badge.png')
