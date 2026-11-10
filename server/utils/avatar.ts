import sharp from 'sharp'

export const AVATAR_MAX_UPLOAD = 5 * 1024 * 1024
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Center-crop to 256x256 WebP; animated GIF/WebP stay animated. */
export async function processAvatar(input: Uint8Array) {
  return sharp(input, { animated: true, limitInputPixels: 50_000_000 })
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .webp()
    .toBuffer()
}

/** The only key the avatar route may read: exactly what avatar-upload generates for this user (no `..`, no other prefix). */
export const isAvatarRawKey = (userId: string, key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(`avatars/raw/${userId}/`) && /^[0-9a-f-]{36}$/.test(key.slice(`avatars/raw/${userId}/`.length))
