<script setup lang="ts">
import { computed } from 'vue'

import { navigateTo, useRoute, useSettingsModal } from '#imports'

import { dispatchSocketFrame, receiveMessage, resetScenario, responseDelay, scenario, scenarioPresets, type ScenarioPreset } from './fixtures'
import { setVoiceScenario, useVoice } from './voice'

const route = useRoute()
const voice = useVoice()
const preset = computed({ get: () => scenario.value, set: (value: ScenarioPreset) => resetScenario(value) })
const connection = computed({
  get: () => voice.connection.value,
  set: (value: typeof voice.connection.value) => setVoiceScenario({ connection: value }),
})
const microphone = computed({
  get: () => voice.microphone.value,
  set: (value: typeof voice.microphone.value) => setVoiceScenario({ microphone: value }),
})
const audioBlocked = computed({
  get: () => voice.audioBlocked.value,
  set: (value: boolean) => setVoiceScenario({ audioBlocked: value }),
})
const settingsTab = useSettingsModal()
// Rendered inside the Settings modal: close it so the destination is visible.
const go = (path: string) => {
  settingsTab.value = null
  void navigateTo(path)
}
const remoteTyping = () => dispatchSocketFrame({ type: 'typing', channelId: String(route.params.channelId ?? 'ui-general'), userId: 'ui-alex' })
</script>

<template>
  <section aria-label="UI sandbox controls" class="flex max-w-md flex-col gap-3">
    <div>
      <h2 class="font-semibold">UI sandbox</h2>
      <p class="text-xs text-muted">Local fixtures · no backend or devices</p>
    </div>
    <UFormField label="Preset">
      <USelect v-model="preset" :items="[...scenarioPresets]" class="w-full" />
    </UFormField>
    <div class="flex flex-wrap gap-2">
      <UButton label="Reset" color="neutral" variant="soft" @click="resetScenario(preset)" />
      <UButton label="Chat" color="neutral" variant="soft" @click="go('/c/ui-general')" />
      <UButton label="Voice room" color="neutral" variant="soft" @click="go('/c/ui-voice')" />
    </div>
    <UButton label="Alex is typing here" color="neutral" variant="outline" @click="remoteTyping" />
    <div class="flex flex-wrap gap-2">
      <UButton label="Incoming DM" color="neutral" variant="outline" @click="receiveMessage('ui-dm')" />
      <UButton label="Incoming channel message" color="neutral" variant="outline" @click="receiveMessage('ui-unread')" />
      <UButton label="Message edge cases" color="neutral" variant="soft" @click="go('/c/ui-showcase')" />
    </div>
    <UFormField :label="`API delay: ${responseDelay} ms (reload a channel to see loading)`">
      <USlider v-model="responseDelay" :min="0" :max="3000" :step="250" aria-label="API response delay" />
    </UFormField>
    <USeparator />
    <UFormField label="Voice connection">
      <USelect v-model="connection" :items="['connected', 'disconnected', 'reconnecting', 'signalReconnecting']" class="w-full" />
    </UFormField>
    <UFormField label="Microphone">
      <USelect v-model="microphone" :items="['idle', 'starting', 'ready', 'unavailable']" class="w-full" />
    </UFormField>
    <USwitch v-model="audioBlocked" label="Audio blocked" />
    <p class="text-xs text-muted">Use the real voice controls to mute, deafen, toggle camera/screen sharing, and watch participants.</p>
    <p class="text-xs text-muted">Reset restores unread badges and fake media. Unsupported actions fail locally; uploads and real calls are disabled.</p>
  </section>
</template>
