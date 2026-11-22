<script setup lang="ts">
const socket = useSocket()
const v = useVoice()
const toast = useToast()
// `lost` only turns on after a few seconds down, so brief drops show nothing.
watch(socket.lost, lost =>
  toast.add(
    lost
      ? { title: 'App connection lost. Reconnecting…', color: 'warning', icon: 'i-lucide-wifi-off' }
      : { title: 'App connection restored', color: 'success', icon: 'i-lucide-wifi' },
  ),
)
const message = computed(() => {
  const parts: string[] = []
  if (socket.offline.value) parts.push('Offline. Waiting for your network to return.')
  if (v.lost.value && (v.connection.value === 'reconnecting' || v.connection.value === 'signalReconnecting')) parts.push('Reconnecting voice…')
  if (v.channelId.value && v.microphone.value === 'unavailable') parts.push('Your microphone is unavailable. You can still listen.')
  if (v.retryChannelId.value) parts.push("Couldn't reconnect voice.")
  return parts.join(' ')
})
</script>

<template>
  <div role="status" aria-live="polite" aria-atomic="true" class="relative z-20 h-0 shrink-0">
    <div v-if="message" class="absolute inset-x-0 top-0 max-h-[50dvh] overflow-y-auto bg-(--ui-bg-base) shadow-lg">
      <UAlert :title="message" icon="i-lucide-wifi-off" color="warning" variant="soft" class="rounded-none">
        <template #actions>
          <UButton
            v-if="v.channelId.value && v.microphone.value === 'unavailable'"
            label="Enable microphone"
            icon="i-lucide-mic"
            @click="v.enableMicrophone()"
          />
          <UButton
            v-if="v.retryChannelId.value"
            label="Rejoin voice"
            icon="i-lucide-refresh-cw"
            :disabled="!socket.connected.value"
            :loading="v.connecting.value"
            @click="v.reconnect()"
          />
          <UButton v-if="v.channelId.value || v.connecting.value" label="Leave voice" color="neutral" variant="outline" @click="v.leave()" />
          <UButton v-else-if="v.retryChannelId.value" label="Dismiss" color="neutral" variant="outline" @click="v.leave(false)" />
        </template>
      </UAlert>
    </div>
  </div>
</template>
