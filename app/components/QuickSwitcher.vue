<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const { dms, textChannels, voiceChannels } = useNavChannels()
const { data: users, nameOf } = useUsers()
const { data: me } = useMe()
const colorMode = useColorMode()
const go = (to: string) => () => {
  open.value = false
  void navigateTo(to)
}
const shortcutsOpen = useShortcutsOverlay()
const settingsTab = useSettingsModal()
const groups = computed(() => [
  { id: 'channels', label: 'Channels', items: textChannels.value.map(c => ({ label: c.name ?? '', icon: 'i-lucide-hash', onSelect: go(`/c/${c.id}`) })) },
  {
    id: 'voice',
    label: 'Voice channels',
    items: voiceChannels.value.map(c => ({ label: c.name ?? '', icon: 'i-lucide-volume-2', onSelect: go(`/c/${c.id}`) })),
  },
  {
    id: 'dms',
    label: 'Direct messages',
    items: dms.value.map(c => ({ label: nameOf(c.otherUserId ?? ''), icon: 'i-lucide-message-circle', onSelect: go(`/c/${c.id}`) })),
  },
  {
    id: 'people',
    label: 'People',
    items: users.value
      .filter(u => u.id !== me.value?.id && u.displayName)
      .map(u => ({
        label: u.displayName!,
        suffix: 'Send a message',
        icon: 'i-lucide-user',
        onSelect: () => {
          open.value = false
          void openDmWith(u.id)
        },
      })),
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      {
        label: 'Settings',
        icon: 'i-lucide-settings',
        onSelect: () => {
          open.value = false
          settingsTab.value = 'profile'
        },
      },
      {
        label: 'Keyboard shortcuts',
        icon: 'i-lucide-keyboard',
        onSelect: () => {
          open.value = false
          shortcutsOpen.value = true
        },
      },
      {
        label: 'Toggle theme',
        icon: 'i-lucide-sun-moon',
        onSelect: () => {
          open.value = false
          colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
        },
      },
    ],
  },
])
</script>

<template>
  <UModal v-model:open="open" title="Quick switcher" description="Jump to a channel, a conversation or a person">
    <template #content>
      <UCommandPalette :groups="groups" placeholder="Jump to…" aria-label="Quick switcher" close @update:open="open = $event" />
    </template>
  </UModal>
</template>
