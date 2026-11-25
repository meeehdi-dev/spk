const audio = document.getElementById('audio')
const choose = id => window.spkPicker.choose(id, audio.checked)

const card = source => {
  const button = document.createElement('button')
  button.type = 'button'
  const thumb = document.createElement('img')
  thumb.className = 'thumb'
  thumb.src = source.thumb
  thumb.alt = ''
  const row = document.createElement('div')
  row.className = 'name'
  if (source.icon) {
    const icon = document.createElement('img')
    icon.src = source.icon
    icon.alt = ''
    row.append(icon)
  }
  const label = document.createElement('span')
  label.textContent = source.name
  row.append(label)
  button.append(thumb, row)
  button.addEventListener('click', () => choose(source.id))
  return button
}

document.getElementById('cancel').addEventListener('click', () => window.spkPicker.choose(null, false))
document.addEventListener('keydown', e => e.key === 'Escape' && window.spkPicker.choose(null, false))

void window.spkPicker.sources().then(data => {
  document.getElementById('audio-label').hidden = !data.audio
  for (const kind of ['screen', 'window']) {
    const items = data.sources.filter(s => s.kind === kind)
    const section = document.getElementById(`${kind}s`)
    section.hidden = !items.length
    section.querySelector('.grid').append(...items.map(card))
  }
  document.querySelector('.grid button')?.focus()
})
