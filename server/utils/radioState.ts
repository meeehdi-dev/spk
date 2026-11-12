import type { RadioState, RadioStation } from '../../shared/utils/radio'

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
export const clearChannelRadio = (channelId: string) => radios.delete(channelId)
export function setChannelRadio(radio: ChannelRadio, station: RadioStation | null) {
  radio.state = { ...radio.state, revision: ++revision, station }
  return radio.state
}
