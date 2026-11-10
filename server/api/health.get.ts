export default defineEventHandler((event) => {
  try {
    useDb().$client.prepare('select 1').get()
    return { ok: true }
  } catch {
    setResponseStatus(event, 503)
    return { ok: false }
  }
})
