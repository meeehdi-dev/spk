<script setup lang="ts">
defineProps<{ uploads: Upload[]; gif?: string | null }>()
const emit = defineEmits<{ cancel: [key: string]; removeGif: [] }>()
</script>

<template>
  <div v-if="gif || uploads.some(u => u.preview)" class="flex flex-wrap gap-2 border-b border-default p-2">
    <div v-if="gif" class="relative">
      <img :src="gif" alt="Selected GIF" class="size-16 rounded-md object-cover" referrerpolicy="no-referrer" />
      <UButton
        class="absolute -top-1.5 -right-1.5 rounded-full"
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="solid"
        aria-label="Remove GIF"
        @click="emit('removeGif')"
      />
    </div>
    <div v-for="u in uploads.filter(x => x.preview)" :key="u.key" class="relative">
      <img
        :src="u.preview"
        :alt="u.name"
        class="size-16 rounded-md object-cover"
        :class="[u.state === 'error' ? 'ring-2 ring-error' : '', u.state === 'uploading' ? 'opacity-50' : '', u.spoiler ? 'blur-sm' : '']"
      />
      <UIcon v-if="u.state === 'uploading'" name="i-lucide-loader" class="absolute inset-0 m-auto size-5 animate-spin" />
      <UIcon v-else-if="u.state === 'error'" name="i-lucide-circle-alert" class="absolute inset-0 m-auto size-5 text-error" :title="u.error" />
      <UButton
        class="absolute -top-1.5 -right-1.5 rounded-full"
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="solid"
        :aria-label="u.state === 'uploading' ? 'Cancel upload' : `Remove ${u.name}`"
        @click="emit('cancel', u.key)"
      />
      <UButton
        class="absolute -right-1.5 -bottom-1.5 rounded-full"
        icon="i-lucide-eye-off"
        size="xs"
        :color="u.spoiler ? 'primary' : 'neutral'"
        variant="solid"
        :aria-label="u.spoiler ? 'Remove spoiler' : 'Mark as spoiler'"
        :aria-pressed="u.spoiler"
        @click="u.spoiler = !u.spoiler"
      />
    </div>
  </div>
  <ul v-if="uploads.some(u => !u.preview)" class="flex flex-col gap-1 border-b border-default p-2">
    <li v-for="u in uploads.filter(x => !x.preview)" :key="u.key" class="flex items-center gap-2 text-xs">
      <UIcon :name="fileIcon(u.mime, u.name)" class="size-5 shrink-0" :class="u.state === 'error' ? 'text-error' : ''" />
      <div class="min-w-0 flex-1">
        <div class="flex gap-2">
          <span class="truncate">{{ u.name }}</span>
          <span class="shrink-0 text-muted">{{ formatBytes(u.size) }}</span>
        </div>
        <UProgress v-if="u.state === 'uploading'" :model-value="Math.round(u.progress * 100)" size="xs" />
        <div v-else-if="u.state === 'error'" class="text-error">
          {{ u.error }}
        </div>
      </div>
      <UTooltip v-if="u.mime.startsWith('image/')" :text="u.spoiler ? 'Remove spoiler' : 'Mark as spoiler'">
        <UButton
          icon="i-lucide-eye-off"
          size="xs"
          :color="u.spoiler ? 'primary' : 'neutral'"
          :variant="u.spoiler ? 'soft' : 'ghost'"
          :aria-label="u.spoiler ? 'Remove spoiler' : 'Mark as spoiler'"
          :aria-pressed="u.spoiler"
          @click="u.spoiler = !u.spoiler"
        />
      </UTooltip>
      <UTooltip :text="u.state === 'uploading' ? 'Cancel upload' : 'Remove'">
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          :aria-label="u.state === 'uploading' ? 'Cancel upload' : 'Remove file'"
          @click="emit('cancel', u.key)"
        />
      </UTooltip>
    </li>
  </ul>
</template>
