<script setup lang="ts">
import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'
import type { ChannelEntry } from '~/composables/useUsers'
const location = import.meta.client ? window.location : ({ origin: '' } as Location)
const route = useRoute()
const { data: me } = useMe()
const { data: users, nameOf, byId } = useUsers()
const { of: unreadOf } = useUnread()
const { hide } = useHiddenDms()
const { dms, textChannels, voiceChannels } = useNavChannels()
const voice = useVoice()
const colorMode = useColorMode()
const shortcutsOpen = useShortcutsOverlay()
const settingsTab = useSettingsModal()
async function signOut() {
  settingsTab.value = null
  await authClient.signOut()
  await refreshNuxtData('me')
  await navigateTo('/login')
}
const profileMenu = computed(() => [[
  { label: 'Settings', icon: 'i-lucide-settings', onSelect: () => { settingsTab.value = 'profile' } },
  { label: colorMode.value === 'dark' ? 'Light theme' : 'Dark theme', icon: colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon', onSelect: (e: Event) => { e.preventDefault(); colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark' } },
  { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: () => { shortcutsOpen.value = true } }
], [
  { label: 'Sign out', icon: 'i-lucide-log-out', onSelect: signOut }
]])
const people = computed(() => users.value.filter(u => u.id !== me.value?.id && u.displayName).map(u => ({ label: u.displayName!, onSelect: () => openDmWith(u.id) })))
const { isMuted, toggle: toggleMute } = useMute()
const muteItem = (id: string) => ({ label: isMuted(id) ? 'Unmute notifications' : 'Mute notifications', icon: isMuted(id) ? 'i-lucide-bell' : 'i-lucide-bell-off', onSelect: () => toggleMute(id) })
const readNow = (id: string) => markChannelRead(id)
const channelMenu = (c: ChannelEntry) => [[
  { label: 'Mark read', icon: 'i-lucide-check-check', onSelect: () => readNow(c.id) },
  muteItem(c.id),
  { label: 'Copy link', icon: 'i-lucide-link', onSelect: () => copyText(`${location.origin}/c/${c.id}`) }
], admin.channelItems(c)].filter(g => g.length)
const admin = useAdmin()
// Admins drag channels within their section; the order is saved in channels.position.
const textList = ref<HTMLElement>()
const voiceList = ref<HTMLElement>()
// Only admins render the drag handle, so nobody else can start a drag. Sortable moves the DOM node itself: put it back, the refetch re-renders in the new order.
const sortable = (el: Ref<HTMLElement | undefined>, type: 'text' | 'voice') => useSortable(el, [] as string[], {
  animation: 150, handle: '[data-drag]', watchElement: true,
  onUpdate: (e: { item: HTMLElement, from: HTMLElement, oldIndex?: number, newIndex?: number }) => {
    removeNode(e.item); insertNodeAt(e.from, e.item, e.oldIndex!)
    const ids = (type === 'text' ? textChannels : voiceChannels).value.map(c => c.id)
    ids.splice(e.newIndex!, 0, ...ids.splice(e.oldIndex!, 1))
    void admin.reorder(type, ids)
  }
})
sortable(textList, 'text')
sortable(voiceList, 'voice')
const sections = useLocalStorage('spk:sidebar-sections', { dms: true, text: true, voice: true })
</script>

<template>
  <div class="flex h-full flex-col">
  <nav class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
    <div class="px-2 py-2 text-center text-2xl font-bold text-primary">spk</div>

    <UCollapsible v-model:open="sections.dms">
      <UButton label="Direct messages" icon="i-lucide-message-circle" color="neutral" variant="soft" size="xs" block class="justify-start font-bold uppercase tracking-wider [&>span:last-child]:ml-auto"
        :trailing-icon="sections.dms ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
      <template #content>
        <ul class="py-1">
          <li v-for="c in dms" :key="c.id">
            <UContextMenu :items="[
              { label: 'Mark read', icon: 'i-lucide-check-check', onSelect: () => readNow(c.id) },
              muteItem(c.id),
              { label: 'Hide', icon: 'i-lucide-eye-off', onSelect: () => { hide(c); if (route.params.channelId === c.id) navigateTo('/') } }
            ]">
              <UButton :to="`/c/${c.id}`" :label="nameOf(c.otherUserId ?? '')" icon="i-lucide-message-circle" color="neutral"
                :variant="route.params.channelId === c.id ? 'soft' : 'ghost'" block class="justify-start" :class="[unreadOf(c.id).unread ? 'font-bold' : '', isMuted(c.id) ? 'opacity-50' : '']">
                <template #trailing>
                  <UBadge v-if="unreadOf(c.id).mentions" :label="String(unreadOf(c.id).mentions)" color="error" size="sm" class="ml-auto" aria-label="Mentions" />
                  <UBadge v-if="unreadOf(c.id).unread" :label="String(unreadOf(c.id).unread)" color="neutral" variant="subtle" size="sm" :class="{ 'ml-auto': !unreadOf(c.id).mentions }" aria-label="Unread messages" />
                </template>
              </UButton>
            </UContextMenu>
          </li>
          <li class="px-1 pt-1">
            <UDropdownMenu :items="people" :content="{ align: 'start' }">
              <UButton label="New message" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" block class="justify-start" />
            </UDropdownMenu>
          </li>
        </ul>
      </template>
    </UCollapsible>

    <UCollapsible v-model:open="sections.text">
      <UButton label="Text channels" icon="i-lucide-hash" color="neutral" variant="soft" size="xs" block class="justify-start font-bold uppercase tracking-wider [&>span:last-child]:ml-auto"
        :trailing-icon="sections.text ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
      <template #content>
        <ul ref="textList" class="py-1">
          <li v-for="c in textChannels" :key="c.id" class="flex items-center">
            <UIcon v-if="admin.isAdmin.value" data-drag name="i-lucide-grip-vertical" class="size-3.5 shrink-0 cursor-grab text-dimmed" aria-hidden="true" />
            <UContextMenu :items="channelMenu(c) as never" class="min-w-0 flex-1">
              <UButton
                :to="`/c/${c.id}`" :label="c.name ?? ''" icon="i-lucide-hash" color="neutral"
                :variant="route.params.channelId === c.id ? 'soft' : 'ghost'" block class="justify-start" :class="[unreadOf(c.id).unread ? 'font-bold' : '', isMuted(c.id) ? 'opacity-50' : '']"
              >
                <template #trailing>
                  <UBadge v-if="unreadOf(c.id).mentions" :label="String(unreadOf(c.id).mentions)" color="error" size="sm" class="ml-auto" aria-label="Mentions" />
                  <UBadge v-if="unreadOf(c.id).unread" :label="String(unreadOf(c.id).unread)" color="neutral" variant="subtle" size="sm" :class="{ 'ml-auto': !unreadOf(c.id).mentions }" aria-label="Unread messages" />
                </template>
              </UButton>
            </UContextMenu>
          </li>
        </ul>
        <UButton v-if="admin.isAdmin.value" label="New text channel" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" block class="justify-start" @click="admin.dialog.value = { kind: 'create', type: 'text' }" />
      </template>
    </UCollapsible>

    <UCollapsible v-model:open="sections.voice">
      <UButton label="Voice channels" icon="i-lucide-volume-2" color="neutral" variant="soft" size="xs" block class="justify-start font-bold uppercase tracking-wider [&>span:last-child]:ml-auto"
        :trailing-icon="sections.voice ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
      <template #content>
        <ul ref="voiceList" class="py-1">
          <li v-for="c in voiceChannels" :key="c.id">
            <div class="group/row flex items-center">
              <UIcon v-if="admin.isAdmin.value" data-drag name="i-lucide-grip-vertical" class="size-3.5 shrink-0 cursor-grab text-dimmed" aria-hidden="true" />
              <UContextMenu :items="channelMenu(c) as never" class="min-w-0 flex-1">
                <UButton :to="`/c/${c.id}`" :label="c.name ?? ''" icon="i-lucide-volume-2" color="neutral"
                  :variant="route.params.channelId === c.id ? 'soft' : 'ghost'" block class="justify-start" />
              </UContextMenu>
              <UTooltip v-if="voice.channelId.value !== c.id" :text="`Join ${c.name}`">
                <UButton icon="i-lucide-phone" color="neutral" variant="ghost" :aria-label="`Join ${c.name}`"
                  class="self-stretch opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                  :class="route.params.channelId === c.id ? '[@media(hover:none)]:opacity-100' : ''" @click="voice.join(c.id)" />
              </UTooltip>
            </div>
            <ul class="ml-6">
              <UserContext v-for="m in voiceMembers(c.id)" :key="m.userId" :user-id="m.userId">
              <li class="flex items-center gap-2 py-0.5 text-sm text-muted">
                <UAvatar :src="avatarSrc(byId.get(m.userId))" :alt="nameOf(m.userId)" size="3xs" :chip="presenceChip(m.userId)" class="ring-2 transition" :class="m.speaking ? 'ring-success' : 'ring-transparent'" />
                <span class="truncate">{{ nameOf(m.userId) }}</span>
                <UIcon v-if="m.screen" name="i-lucide-screen-share" class="ml-auto size-3.5 shrink-0 text-primary" aria-label="Sharing screen" />
                <UIcon v-if="m.cam" name="i-lucide-video" class="size-3.5 shrink-0 text-primary" :class="m.screen ? '' : 'ml-auto'" aria-label="Camera on" />
                <UIcon v-if="m.deafened" name="i-lucide-headphone-off" class="size-3.5 shrink-0 text-error" aria-label="Deafened" />
                <UIcon v-else-if="m.muted" name="i-lucide-mic-off" class="size-3.5 shrink-0 text-error" aria-label="Muted" />
              </li>
              </UserContext>
            </ul>
          </li>
        </ul>
        <UButton v-if="admin.isAdmin.value" label="New voice channel" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" block class="justify-start" @click="admin.dialog.value = { kind: 'create', type: 'voice' }" />
      </template>
    </UCollapsible>
  </nav>

  <VoiceBar v-if="voice.channelId.value || voice.connecting.value" panel />

  <div v-if="me" class="shrink-0 border-t border-default p-2">
    <UDropdownMenu :items="profileMenu" :content="{ align: 'start', side: 'top' }" :ui="{ content: 'w-56' }">
      <UButton color="neutral" variant="ghost" block class="justify-start" aria-label="Profile menu">
        <UAvatar :src="avatarSrc(me)" :alt="me.displayName ?? ''" icon="i-lucide-user" size="sm" :chip="presenceChip(me.id)" />
        <span class="min-w-0 text-left">
          <span class="block truncate text-sm font-medium">{{ me.displayName ?? me.email }}</span>
          <span class="block text-xs capitalize text-muted">{{ presenceOf(me.id) }}</span>
        </span>
        <UIcon name="i-lucide-chevrons-up-down" class="ml-auto size-4 shrink-0 text-muted" />
      </UButton>
    </UDropdownMenu>
  </div>
  </div>
</template>
