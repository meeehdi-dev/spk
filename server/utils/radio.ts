import type { Peer } from 'crossws'

import { createLimiter } from './limiter'
import { sendToUser } from './peers'
import { countRadioClick, getRadioStation, isStationId } from './radioApi'
import { channelRadio, isCurrentRadio, setChannelRadio } from './radioState'
import { readySessionOf, sessionsIn } from './voicePresence'

const allowChange = createLimiter(1, 3000)

/** Commands must come from the socket that owns the current, connected voice session. */
export async function handleRadioFrame(userId: string, m: Record<string, unknown>, owner: unknown) {
  const peer = owner as Peer
  const reply = (data: unknown) => peer?.send(JSON.stringify(data))
  const sid = typeof m.sid === 'string' ? m.sid : ''
  const session = readySessionOf(userId, sid, owner)
  if (!session) {
    reply({ type: 'voice:radio:error', sid, error: 'Join voice before controlling the radio' })
    return
  }
  const { channelId } = session
  const radio = channelRadio(channelId)
  if (m.type === 'voice:radio:get') {
    reply({ type: 'voice:radio:state', sid, ...radio.state })
    return
  }
  try {
    if (m.type === 'voice:radio:set' && !isStationId(m.stationId)) throw new Error('Invalid station identifier')
    if (!allowChange(userId)) throw new Error('Wait three seconds between radio changes')
    const stationId = m.stationId as string
    const change = radio.pending.then(async () => {
      const current = () => readySessionOf(userId, sid, owner)?.channelId === channelId && isCurrentRadio(channelId, radio)
      if (!current()) throw new Error('Your voice session changed')
      const station = m.type === 'voice:radio:set' ? await getRadioStation(stationId) : null
      if (!current()) throw new Error('Your voice session changed')
      const state = setChannelRadio(radio, station)
      for (const s of sessionsIn(channelId)) {
        sendToUser(s.userId, { type: 'voice:radio:state', sid: s.sid, ...state })
      }
      if (station) void countRadioClick(station.id)
    })
    radio.pending = change.catch(() => {})
    await change
  } catch (e) {
    reply({ type: 'voice:radio:error', sid, channelId, error: (e as Error).message })
  }
}
