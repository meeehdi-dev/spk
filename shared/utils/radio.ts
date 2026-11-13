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

export interface RadioSummary {
  channelId: string
  station: Pick<RadioStation, 'id' | 'name'> | null
}

export type RadioFavorite = Omit<RadioStation, 'url'> & { available: boolean | null }
