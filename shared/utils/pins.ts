/** Anyone pins in their own DMs; in text channels only admins do. */
export const canPin = (channelType: string | undefined, role: string | null | undefined) => channelType === 'dm' || (channelType === 'text' && role === 'admin')
