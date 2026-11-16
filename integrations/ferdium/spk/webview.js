module.exports = Ferdium => {
  Ferdium.loop(() => {
    const count = Number(document.querySelector('meta[name="spk-unread"]')?.getAttribute('content'))
    Ferdium.setBadge(Number.isSafeInteger(count) && count > 0 ? count : 0)
  })
}
