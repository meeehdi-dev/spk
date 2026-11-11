export interface Me {
  id: string
  email: string
  role: 'admin' | 'user'
  displayName: string | null
  avatarKey: string | null
}

/** The signed-in user (null if signed out). Refresh after profile changes. */
export function useMe() {
  return useFetch<Me | null>('/api/profile/me', { key: 'me', headers: useRequestHeaders(['cookie']), default: () => null, onResponseError: () => {} })
}
