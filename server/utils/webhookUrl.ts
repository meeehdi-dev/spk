import { appOrigin } from './appOrigin'

export const webhookUrl = (id: string, secret: string) => `${appOrigin()}/api/hooks/${id}/${secret}`
