<script setup lang="ts">
const socket = useSocket()
const v = useVoice()
const toast = useToast()
let interrupted = false
watch(socket.connected, (on, was) => {
  if (!on && was) {
    interrupted = true
    toast.add({ title: 'App connection lost. Reconnecting…', color: 'warning', icon: 'i-lucide-wifi-off' })
  } else if (on && interrupted) {
    interrupted = false
    toast.add({ title: 'App connection restored', color: 'success', icon: 'i-lucide-wifi' })
  }
})
const message = computed(() => {
  const parts: string[] = []
  if (socket.offline.value) parts.push('Offline. Waiting for your network to return.')
  else if (!socket.connected.value) parts.push('App reconnecting. Voice may still work.')
  if (v.connection.value === 'reconnecting') parts.push('Voice interrupted. Reconnecting automatically…')
  else if (v.connection.value === 'signalReconnecting') parts.push('Voice signaling reconnecting. Audio may still work.')
  if (v.audioBlocked.value) parts.push('Audio playback is blocked. Enable audio to hear the call.')
  if (v.retryChannelId.value) parts.push('Voice disconnected. Rejoin when you are ready.')
  return parts.join(' ')
})
</script>

<template>
  <div role="status" aria-live="polite" aria-atomic="true" class="shrink-0">
    <UAlert v-if="message" :title="message" icon="i-lucide-wifi-off" color="warning" variant="soft" class="rounded-none">
      <template #actions>
        <UButton v-if="v.audioBlocked.value" label="Enable audio" icon="i-lucide-volume-2" @click="v.enableAudio()" />
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
</template>
