export interface RadioStation {
  id: string
  name: string
  url: string
  country: string
  codec: string
}

export interface RadioState {
  channelId: string
  revision: number
  station: RadioStation | null
}
