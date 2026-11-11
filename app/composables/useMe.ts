import { appendResponseHeader } from 'h3'

export interface Me {
  id: string
  email: string
  role: 'admin' | 'user'
  displayName: string | null
  avatarKey: string | null
}

/** The signed-in user (null if signed out). Refresh after profile changes. */
export function useMe() {
  const event = useRequestEvent()
  return useFetch<Me | null>('/api/profile/me', {
    key: 'me',
    headers: useRequestHeaders(['cookie']),
    default: () => null,
    onResponseError: () => {},
    // SSR's internal fetch drops Set-Cookie; forward the refreshed session cookie to the page response
    onResponse: ({ response }) => {
      if (import.meta.server && event) for (const c of response.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', c)
    },
  })
}
