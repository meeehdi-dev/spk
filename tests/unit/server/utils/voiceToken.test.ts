import { describe, expect, it } from 'vitest'

import { createVoiceToken } from '~~/server/utils/voiceToken'

describe('createVoiceToken', () => {
  it('is a JWT for the channel room with the user as identity', async () => {
    const jwt = await createVoiceToken({ apiKey: 'devkey', apiSecret: 'secretsecretsecretsecretsecretsecret', userId: 'u1', name: 'Alex', channelId: 'room1' })
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())
    expect(claims).toMatchObject({ iss: 'devkey', sub: 'u1', name: 'Alex', video: { room: 'room1', roomJoin: true } })
  })
})
