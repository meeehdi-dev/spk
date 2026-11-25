const form = document.querySelector('form')
const input = document.querySelector('input')
const error = document.querySelector('[role="alert"]')

const params = new URLSearchParams(location.search)
input.value = params.get('server') ?? ''
error.textContent = params.get('error') ?? ''

form.addEventListener('submit', async e => {
  e.preventDefault()
  error.textContent = (await window.spkDesktop.setServer(input.value)) ?? ''
})
