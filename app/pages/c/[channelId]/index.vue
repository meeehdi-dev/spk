<script setup lang="ts">
const route = useRoute()
const { data: channels } = useChannels()
const isVoice = computed(() => channels.value.find(c => c.id === route.params.channelId)?.type === 'voice')
</script>

<template>
  <VoiceChannelView v-if="isVoice" :channel-id="String(route.params.channelId)" />
  <ChatChannelView v-else :channel-id="String(route.params.channelId)" />
</template>
