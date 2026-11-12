<script setup lang="ts">
import type { RadioSummary } from '#shared/utils/radio'

const props = defineProps<{ station: RadioSummary['station'] | undefined }>()
const label = computed(() => `Radio selected: ${props.station?.name ?? ''}`)
</script>

<template>
  <UTooltip v-if="station" :text="label">
    <span
      tabindex="0"
      role="img"
      :aria-label="label"
      class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-success focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <UIcon name="i-lucide-radio" class="size-4" aria-hidden="true" />
    </span>
  </UTooltip>
</template>
