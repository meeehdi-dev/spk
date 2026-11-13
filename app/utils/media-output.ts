const sinks = new WeakMap<HTMLMediaElement, string>()

/** Restore the latest choice if an older device switch finishes last. */
export async function routeMediaOutput(element: HTMLMediaElement, device: string) {
  if (!('setSinkId' in element)) return
  sinks.set(element, device)
  async function route() {
    const desired = sinks.get(element)!
    try {
      await element.setSinkId(desired)
    } catch {
      if (desired === sinks.get(element)) await element.setSinkId('').catch(() => {})
    }
    if (desired !== sinks.get(element)) await route()
  }
  await route()
}
