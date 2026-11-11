<script setup lang="ts">
const s = useNotifySettings()
const { permission, ask } = useNotificationPermission()
const push = usePush()
const toast = useToast()
const busy = ref(false)

async function enable() {
  busy.value = true
  try {
    await ask()
    if (permission.value === 'granted' && push.supported) await push.subscribe()
    else if (permission.value === 'denied') toast.add({ title: 'Notifications are blocked in your browser settings', color: 'warning', icon: 'i-lucide-bell-off' })
  } catch (e) {
    toast.add({ title: 'Could not enable push', description: (e as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally { busy.value = false }
}
const disablePush = () => push.unsubscribe().catch(() => toast.add({ title: 'Could not turn push off', color: 'error', icon: 'i-lucide-circle-alert' }))
</script>

<template>
  <div class="flex flex-col gap-6">
    <UCard>
      <template #header>
        <h2 class="font-bold">
          System notifications
        </h2>
      </template>
      <div class="flex flex-col gap-3 text-sm">
        <p
          v-if="permission === 'unsupported'"
          class="text-muted"
        >
          This browser can't show notifications. On iOS, add spk to the home screen first.
        </p>
        <template v-else>
          <p class="text-muted">
            <template v-if="permission === 'granted'">
              Allowed. {{ push.supported ? (push.subscribed.value ? 'Push is on: you also get notifications while spk is closed.' : 'Push is off: you only get notifications while spk is open.') : 'Push is not set up on this server.' }}
            </template>
            <template v-else-if="permission === 'denied'">
              Blocked. Allow notifications for this site in your browser settings.
            </template>
            <template v-else>
              Not enabled yet.
            </template>
          </p>
          <div class="flex gap-2">
            <UButton
              v-if="permission !== 'granted' || (push.supported && !push.subscribed.value)"
              :loading="busy"
              label="Enable notifications"
              icon="i-lucide-bell"
              @click="enable"
            />
            <UButton
              v-if="push.subscribed.value"
              label="Turn push off"
              icon="i-lucide-bell-off"
              color="neutral"
              variant="outline"
              @click="disablePush"
            />
          </div>
        </template>
      </div>
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-bold">
          What notifies you
        </h2>
      </template>
      <div class="flex flex-col gap-3">
        <USwitch
          v-model="s.dms"
          label="Direct messages"
          icon="i-lucide-message-circle"
        />
        <USwitch
          v-model="s.pings"
          label="Mentions and replies"
          icon="i-lucide-at-sign"
          description="In channels, only when you are mentioned or replied to."
        />
        <USwitch
          v-model="s.dnd"
          label="Do Not Disturb"
          icon="i-lucide-moon"
          description="No notifications and no sound."
        />
      </div>
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-bold">
          Sound
        </h2>
      </template>
      <div class="flex flex-col gap-3">
        <USwitch
          v-model="s.sound"
          label="Message sound"
          icon="i-lucide-volume-2"
        />
        <UFormField label="Volume">
          <div class="flex items-center gap-3">
            <USlider
              v-model="s.volume"
              :min="0"
              :max="1"
              :step="0.05"
              :disabled="!s.sound"
              class="max-w-xs"
            />
            <UButton
              icon="i-lucide-play"
              color="neutral"
              variant="ghost"
              aria-label="Test sound"
              @click="playBlip(s.volume)"
            />
          </div>
        </UFormField>
      </div>
    </UCard>
    <p class="text-sm text-muted">
      Mute a single channel or DM from its right-click menu in the sidebar.
    </p>
  </div>
</template>
