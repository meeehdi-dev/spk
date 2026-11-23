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
// Registered by the dev-only UI sandbox (dev/ui/panel-plugin.ts); absent in normal runs.
const sandboxPanel = import.meta.dev ? useNuxtApp().vueApp.component('UiSandboxPanel') : undefined
const sandbox = ref(false)
watch(tab, () => {
  sandbox.value = false
})
const items = computed(() => [
  ...SETTINGS_TABS.filter(t => !('admin' in t) || me.value?.role === 'admin').map(t => ({
    label: t.label,
    icon: t.icon,
    active: !sandbox.value && tab.value === t.id,
    onSelect: () => {
      tab.value = t.id
      sandbox.value = false
    },
  })),
  ...(sandboxPanel
    ? [
        {
          label: 'UI sandbox',
          icon: 'i-lucide-flask-conical',
          active: sandbox.value,
          class: 'text-inverted before:bg-primary hover:text-inverted hover:before:bg-primary/90',
          ui: { linkLeadingIcon: 'text-inverted group-hover:text-inverted' },
          onSelect: () => {
            sandbox.value = true
          },
        },
      ]
    : []),
])
const view = computed(() =>
  sandbox.value
    ? sandboxPanel
    : tab.value
      ? {
          profile: resolveComponent('SettingsProfile'),
          appearance: resolveComponent('SettingsAppearance'),
          voice: resolveComponent('SettingsVoice'),
          notifications: resolveComponent('SettingsNotifications'),
          shortcuts: resolveComponent('SettingsShortcuts'),
          changelog: resolveComponent('SettingsChangelog'),
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
    :ui="{
      content: wide ? 'h-[85dvh] max-w-6xl' : '',
      body: 'flex min-h-0 flex-col p-0 sm:p-0 md:flex-row compact:p-0 compact:sm:p-0',
    }"
  >
    <template #body>
      <!-- Sidebar on desktop; on mobile the same menu is a compact grid above the content. -->
      <nav aria-label="Settings" class="shrink-0 overflow-y-auto p-3 md:w-52 compact:p-2">
        <UNavigationMenu :items="items" orientation="vertical" highlight :ui="{ list: 'max-md:grid max-md:grid-cols-2' }" />
      </nav>
      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 compact:p-3 compact:sm:p-4">
        <Suspense>
          <component :is="view" :key="tab" />
        </Suspense>
      </div>
    </template>
  </UModal>
</template>
