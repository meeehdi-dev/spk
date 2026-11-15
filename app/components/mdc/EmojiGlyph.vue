<script setup lang="ts">
import { version } from '@iconify-json/twemoji/package.json'

const props = defineProps<{ emoji: string }>()
const code = computed(() =>
  Array.from(props.emoji.replace(/\uFE0F/g, ''))
    .map(char => char.codePointAt(0)!.toString(16).padStart(4, '0'))
    .join('-'),
)
const src = computed(() => `/twemoji/${version}/${code.value}.svg`)
const failed = ref<string>()
</script>

<template>
  <span class="emoji inline-flex size-[1em] shrink-0 items-center justify-center align-middle leading-none">
    <img v-if="failed !== src" :key="src" :src="src" :alt="emoji" class="size-full object-contain" draggable="false" @error="failed = src" />
    <template v-else>{{ emoji }}</template>
  </span>
</template>
