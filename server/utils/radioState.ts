import type { RadioState, RadioStation, RadioSummary } from '../../shared/utils/radio'

import { broadcast } from './peers'

const summary = ({ channelId, station }: RadioState): RadioSummary => ({
  channelId,
  station: station ? { id: station.id, name: station.name } : null,
})

interface ChannelRadio {
  state: RadioState
  pending: Promise<void>
}
const radios = new Map<string, ChannelRadio>()
let revision = 0

export function channelRadio(channelId: string): ChannelRadio {
  let radio = radios.get(channelId)
  if (!radio) {
    radio = { state: { channelId, revision: ++revision, station: null }, pending: Promise.resolve() }
    radios.set(channelId, radio)
  }
  return radio
}

export const isCurrentRadio = (channelId: string, radio: ChannelRadio) => radios.get(channelId) === radio
export const radioSnapshot = (): RadioSummary[] => [...radios.values()].filter(r => r.state.station).map(r => summary(r.state))

export function clearChannelRadio(channelId: string) {
  const radio = radios.get(channelId)
  radios.delete(channelId)
  if (radio?.state.station) broadcast({ type: 'radio:update', channelId, station: null })
}
export function setChannelRadio(radio: ChannelRadio, station: RadioStation | null) {
  radio.state = { ...radio.state, revision: ++revision, station }
  broadcast({ type: 'radio:update', ...summary(radio.state) })
  return radio.state
}
