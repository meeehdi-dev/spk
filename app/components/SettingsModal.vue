<script setup lang="ts">
import { SETTINGS_TABS } from '#shared/utils/settings'

const tab = useSettingsModal()
const { data: me } = useMe()
const wide = useMediaQuery('(min-width: 640px)')
const open = computed({
  get: () => tab.value !== null,
  set: o => {
    if (!o) tab.value = null
  },
})
const items = computed(() =>
  SETTINGS_TABS.filter(t => !('admin' in t) || me.value?.role === 'admin').map(t => ({
    label: t.label,
    icon: t.icon,
    active: tab.value === t.id,
    onSelect: () => {
      tab.value = t.id
    },
  })),
)
const view = computed(() =>
  tab.value
    ? {
        profile: resolveComponent('SettingsProfile'),
        appearance: resolveComponent('SettingsAppearance'),
        voice: resolveComponent('SettingsVoice'),
        notifications: resolveComponent('SettingsNotifications'),
        shortcuts: resolveComponent('SettingsShortcuts'),
        soundboard: resolveComponent('SettingsSoundboard'),
        invites: resolveComponent('SettingsInvites'),
        users: resolveComponent('SettingsUsers'),
      }[tab.value]
    : null,
)
</script>

<template>
  <UModal
    v-model:open="open"
    title="Settings"
    description="Your profile and preferences"
    :fullscreen="!wide"
    :ui="{ content: wide ? 'h-[85dvh] max-w-4xl' : '', body: 'flex min-h-0 flex-col p-0 sm:p-0 md:flex-row' }"
  >
    <template #body>
      <!-- Sidebar on desktop; on mobile the same menu is a compact grid above the content. -->
      <nav aria-label="Settings" class="shrink-0 overflow-y-auto border-b border-default p-3 md:w-52 md:border-r md:border-b-0">
        <UNavigationMenu :items="items" orientation="vertical" highlight :ui="{ list: 'max-md:grid max-md:grid-cols-2' }" />
      </nav>
      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <Suspense>
          <component :is="view" :key="tab" />
        </Suspense>
      </div>
    </template>
  </UModal>
</template>
