<script setup lang="ts">
const emit = defineEmits<{ pick: [emoji: string] }>()
const host = ref<HTMLElement>()
const colorMode = useColorMode()

onMounted(async () => {
  const { Picker } = await import('emoji-picker-element')
  const picker = new Picker({ dataSource: emojiDataUrl() })
  picker.classList.add(colorMode.value === 'dark' ? 'dark' : 'light')
  // Default yellow tone only and no recently-used list: hide those two parts.
  const style = document.createElement('style')
  style.textContent = '.favorites, .skintone-button-wrapper { display: none !important; }'
  picker.shadowRoot?.appendChild(style)
  picker.addEventListener('emoji-click', (e) => emit('pick', e.detail.unicode ?? ''))
  host.value?.appendChild(picker)
})
</script>

<template>
  <div ref="host" />
</template>
