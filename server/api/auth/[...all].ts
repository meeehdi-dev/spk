
export default defineEventHandler(async (event) => {
  const res = await useAuth().handler(toWebRequest(event))
  // better-auth answers failures with a Response (nothing is thrown), so log it here. Only its error JSON ({ code, message }) is read, never the request.
  if (res.status >= 400) {
    const err = await res.clone().json().catch(() => null) as { code?: string, message?: string } | null
    logFailure({ method: event.method, url: event.path, status: res.status, message: [err?.code, err?.message].filter(Boolean).join(': ') })
  }
  return res
})
