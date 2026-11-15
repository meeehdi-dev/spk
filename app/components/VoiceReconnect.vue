<script setup lang="ts">
defineProps<{ labeled?: boolean }>()
const v = useVoice()
</script>

<template>
  <UPopover>
    <UButton
      icon="i-lucide-refresh-cw"
      color="neutral"
      variant="ghost"
      aria-label="Reconnect voice"
      :label="labeled ? 'Reconnect voice' : undefined"
      :disabled="v.connecting.value"
    />
    <template #content="{ close }">
      <div class="flex w-64 flex-col gap-3 p-3 text-sm">
        <p>Reconnect if you cannot hear someone. This stops your camera and screen sharing.</p>
        <UButton
          label="Reconnect voice"
          icon="i-lucide-refresh-cw"
          @click="
            close();
            v.reconnect()
          "
        />
      </div>
    </template>
  </UPopover>
</template>
