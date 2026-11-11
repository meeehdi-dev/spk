<script setup lang="ts">
const open = ref(false)
const route = useRoute()
const { data: me } = useMe()
const { data: channels } = useChannels()
const label = useChannelLabel()
useUnreadLive()
useDraftsLive()
useIncomingNotifications()
useVoiceLive()
usePresenceLive()
useAdminLive()
const voice = useVoice()
const current = computed(() => channels.value.find(c => c.id === route.params.channelId))
const isVoice = computed(() => current.value?.type === 'voice')
const title = computed(() => (route.path.startsWith('/c/') ? label(current.value).replace(/^#/, '') : undefined))
watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)
const search = useSearch()
const isLarge = useMediaQuery('(min-width: 1024px)')
// Desktop sidebar: hidden completely, remembered in a cookie so SSR renders it right. While it (or the drawer) is out of sight and you're in voice, the controls show as the bottom bar.
const sidebarHidden = useCookie<boolean>('spk-sidebar-hidden', { default: () => false, maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
const bottomVoice = computed(() => (voice.channelId.value || voice.connecting.value) && (isLarge.value ? sidebarHidden.value : !open.value))
const panel = ref<{ onKey: (e: KeyboardEvent) => void }>()
const searchFocus = () => {
  if (!search.open) search.show(inChat.value ? 'channel' : 'everything')
}
const inChat = computed(() => route.path.startsWith('/c/'))
const { all: navChannels } = useNavChannels()
const { of: unreadOf } = useUnread()
const switcher = ref(false)
const shortcutsOpen = useShortcutsOverlay()
const searchInput = () => document.getElementById('search-input')
const stepTo = (step: 1 | -1, unreadOnly: boolean) => {
  const ids = navChannels.value.map(c => c.id)
  const cur = route.params.channelId as string | undefined
  const id = unreadOnly ? stepUnread(ids, cur, step, i => unreadOf(i).unread > 0) : stepChannel(ids, cur, step)
  if (id) void navigateTo(`/c/${id}`)
}
defineShortcuts({
  meta_k: {
    usingInput: true,
    handler: () => {
      switcher.value = !switcher.value
    },
  },
  '?': () => {
    shortcutsOpen.value = true
  },
  alt_arrowup: { usingInput: true, handler: () => stepTo(-1, false) },
  alt_arrowdown: { usingInput: true, handler: () => stepTo(1, false) },
  alt_shift_arrowup: { usingInput: true, handler: () => stepTo(-1, true) },
  alt_shift_arrowdown: { usingInput: true, handler: () => stepTo(1, true) },
  // Not Ctrl/⌘ Shift M / D (Firefox responsive mode / bookmark all tabs, Chrome profile menu). ⌘⌥M minimizes, ⌘⌥D hides the Dock, Ctrl Alt L locks Linux: so all three modifiers.
  meta_alt_shift_m: { usingInput: true, handler: () => voice.toggleMic() },
  meta_alt_shift_d: { usingInput: true, handler: () => voice.toggleHeadphones() },
  meta_alt_shift_e: { usingInput: true, handler: () => voice.toggleCamera() },
  meta_alt_shift_s: { usingInput: true, handler: () => voice.toggleScreen() },
  // Mic options: same three modifiers as mute, letters not used above.
  meta_alt_shift_n: { usingInput: true, handler: () => voice.cycleNoise() },
  meta_alt_shift_o: { usingInput: true, handler: () => voice.toggleEcho() },
  meta_alt_shift_g: { usingInput: true, handler: () => voice.toggleAgc() },
  // Outside text fields only: ⌘/Ctrl B is Bold in the composer and inline editor. ⌘/Ctrl F stays the browser's find.
  meta_b: () => {
    sidebarHidden.value = !sidebarHidden.value
  },
  '/': () => searchInput()?.focus(),
  meta_shift_f: { usingInput: true, handler: () => search.show('everything') },
})
// Not defineShortcuts: it preventDefault()s, which stops Nuxt UI modals and slideovers from closing on Esc.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  // An open modal/slideover owns Esc (settings, profile, shortcuts…): don't also close search behind it.
  if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
  if (search.open) search.close()
  if (document.activeElement === searchInput()) searchInput()?.blur()
})
</script>

<template>
  <div class="flex h-dvh bg-default text-default">
    <NicknameModal v-if="me && !me.displayName" />
    <QuickSwitcher v-model:open="switcher" />
    <ShortcutsOverlay />
    <SettingsModal />
    <VoiceDialogs />
    <AdminDialogs />
    <aside v-if="!sidebarHidden" class="hidden w-64 shrink-0 border-r border-default lg:flex">
      <AppSidebar class="w-full" />
    </aside>

    <USlideover v-model:open="open" side="left" title="Navigation" description="Channels and direct messages">
      <template #body>
        <AppSidebar />
      </template>
    </USlideover>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-3">
        <UButton class="lg:hidden" icon="i-lucide-menu" color="neutral" variant="ghost" aria-label="Open sidebar" @click="open = true" />
        <UTooltip :text="sidebarHidden ? 'Show sidebar' : 'Hide sidebar'" :kbds="['meta', 'B']" class="max-lg:hidden">
          <UButton
            :icon="sidebarHidden ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
            color="neutral"
            variant="ghost"
            :aria-label="sidebarHidden ? 'Show sidebar' : 'Hide sidebar'"
            :aria-expanded="!sidebarHidden"
            @click="sidebarHidden = !sidebarHidden"
          />
        </UTooltip>
        <UIcon
          v-if="route.path.startsWith('/c/')"
          :name="isVoice ? 'i-lucide-volume-2' : current?.type === 'dm' ? 'i-lucide-message-circle' : 'i-lucide-hash'"
          class="size-4 text-muted"
        />
        <h1 class="truncate text-sm font-medium">
          {{ title }}
        </h1>
        <div class="ml-auto flex items-center">
          <UTooltip text="Search" class="lg:hidden">
            <UButton
              icon="i-lucide-search"
              color="neutral"
              variant="ghost"
              aria-label="Search"
              @click="search.open ? search.close() : search.show(inChat ? 'channel' : 'everything')"
            />
          </UTooltip>
          <UInput
            id="search-input"
            v-model="search.q"
            icon="i-lucide-search"
            placeholder="Search"
            aria-label="Search messages"
            size="sm"
            class="w-56 max-lg:hidden xl:w-72"
            @focus="searchFocus"
            @input="searchFocus"
            @keydown="panel?.onKey($event)"
          >
            <template #trailing>
              <UKbd value="/" />
            </template>
          </UInput>
        </div>
      </header>

      <main class="min-h-0 flex-1" :class="route.path.startsWith('/c/') ? 'overflow-hidden' : 'overflow-y-auto'">
        <slot />
      </main>

      <VoiceBar v-if="bottomVoice" />
    </div>

    <aside v-if="search.open && isLarge" class="w-80 shrink-0 border-l border-default xl:w-96">
      <SearchPanel ref="panel" external />
    </aside>
    <USlideover
      :open="search.open && !isLarge"
      side="right"
      title="Search"
      description="Search messages"
      class="lg:hidden"
      @update:open="!$event && search.close()"
    >
      <template #body>
        <SearchPanel />
      </template>
    </USlideover>
  </div>
</template>
