export const isInternalLink = (href: string) => import.meta.client && !!parseInternalLink(href, location.origin)
