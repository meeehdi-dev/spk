<script setup lang="ts">
import { twemojiSrc } from '~/utils/twemoji'

const props = defineProps<{ emoji: string }>()
const src = computed(() => twemojiSrc(props.emoji))
const failed = ref<string>()
</script>

<template>
  <span class="emoji inline-flex size-[1em] shrink-0 items-center justify-center align-middle leading-none">
    <img v-if="failed !== src" :key="src" :src="src" :alt="emoji" class="size-full object-contain" draggable="false" @error="failed = src" />
    <template v-else>{{ emoji }}</template>
  </span>
</template>
