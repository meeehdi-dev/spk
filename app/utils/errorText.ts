/** User-facing text of a failed $fetch: the server's JSON `message`, then the error's own message, then the fallback. */
export const errorText = (e: unknown, fallback = ''): string => {
  const err = e as { data?: { message?: string }; message?: string } | null | undefined
  return err?.data?.message || err?.message || fallback
}
