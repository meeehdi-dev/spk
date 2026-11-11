<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <ChatChannelView :channel-id="String(route.params.channelId)" :message-id="String(route.params.messageId)" />
</template>
