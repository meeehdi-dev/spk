/** Only the push services used by supported browsers may receive server requests. */
export function isPushEndpoint(input: unknown): input is string {
  // oxlint-disable-next-line no-control-regex -- URL parsing silently strips control characters.
  if (typeof input !== 'string' || !/^https:\/\/[^/]/i.test(input) || input.trim() !== input || /[\u0000-\u0020\u007f\\]/.test(input)) return false
  try {
    const url = new URL(input)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !input.includes('#') &&
      (url.hostname === 'fcm.googleapis.com' ||
        url.hostname === 'updates.push.services.mozilla.com' ||
        /^(?:[a-z0-9-]+\.)+push\.apple\.com$/.test(url.hostname) ||
        /^(?:[a-z0-9-]+\.)+notify\.windows\.com$/.test(url.hostname))
    )
  } catch {
    return false
  }
}
