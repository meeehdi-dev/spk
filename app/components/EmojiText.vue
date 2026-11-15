<script setup lang="ts">
import { splitEmojis } from '#shared/utils/markdown'

const props = defineProps<{ text: string }>()
const parts = computed(() => splitEmojis(props.text))
</script>

<template>
  <span
    ><template v-for="(part, i) in parts" :key="i"><EmojiGlyph v-if="i % 2" :emoji="part" /><template v-else>{{ part }}</template></template></span
  >
</template>
