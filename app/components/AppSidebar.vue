<script setup lang="ts">
import type { ChannelEntry } from '~/composables/useUsers'

import { insertNodeAt, removeNode, useSortable } from '@vueuse/integrations/useSortable'

import { presenceLabel, presenceOf, useMyStatus } from '~/composables/usePresence'

const location = import.meta.client ? window.location : ({ origin: '' } as Location)
const route = useRoute()
const { data: me } = useMe()
const { data: users, nameOf, byId } = useUsers()
const { of: unreadOf } = useUnread()
const { textChannels, voiceChannels, webhooks } = useNavChannels()
const voice = useVoice()
const radioDirectory = useRadioDirectory()
const settingsTab = useSettingsModal()
const myStatus = useMyStatus()
const voiceId = computed(() => voice.channelId.value ?? voice.rejoining.value)
const voiceName = computed(() => allChannels.value.find(c => c.id === voiceId.value)?.name)
const joining = computed(() => voice.connecting.value || !!voice.rejoining.value)
const DOT = { online: 'bg-success', away: 'bg-warning', busy: 'bg-error', offline: 'bg-neutral-400' } as const
const statusMenu = computed(() => [
  (['online', 'away', 'busy', 'offline'] as const).map(s => ({
    label: { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Invisible' }[s],
    slot: s,
    type: 'checkbox' as const,
    checked: myStatus.value === s,
    onUpdateChecked: () => {
      myStatus.value = s
    },
  })),
])
// Everyone but you, newest DM activity first, then the rest A–Z. A user without a DM gets one on click.
const { data: allChannels } = useChannels()
const people = computed(() => {
  const dmOf = new Map(allChannels.value.filter(c => c.type === 'dm').map(c => [c.otherUserId, c]))
  return users.value
    .filter(u => u.id !== me.value?.id && u.id !== BOT_ID && u.displayName && !u.banned)
    .map(u => ({ user: u, dm: dmOf.get(u.id) }))
    .sort((a, b) => (b.dm?.lastActivityAt ?? 0) - (a.dm?.lastActivityAt ?? 0) || a.user.displayName!.localeCompare(b.user.displayName!))
})
const openDm = (p: { user: { id: string }; dm?: ChannelEntry }) => (p.dm ? navigateTo(`/c/${p.dm.id}`) : openDmWith(p.user.id))
const { isMuted, toggle: toggleMute } = useMute()
const muteItem = (id: string) => ({
  label: isMuted(id) ? 'Unmute notifications' : 'Mute notifications',
  icon: isMuted(id) ? 'i-lucide-bell' : 'i-lucide-bell-off',
  onSelect: () => toggleMute(id),
})
const readNow = (id: string) => markChannelRead(id)
const channelMenu = (c: ChannelEntry) =>
  [
    [
      { label: 'Mark read', icon: 'i-lucide-check-check', onSelect: () => readNow(c.id) },
      muteItem(c.id),
      { label: 'Copy link', icon: 'i-lucide-link', onSelect: () => copyText(`${location.origin}/c/${c.id}`) },
    ],
    admin.channelItems(c),
  ].filter(g => g.length)
const admin = useAdmin()
const webhookMenu = (c: ChannelEntry) =>
  [
    [
      { label: 'Mark read', icon: 'i-lucide-check-check', onSelect: () => readNow(c.id) },
      muteItem(c.id),
      { label: 'Copy link', icon: 'i-lucide-link', onSelect: () => copyText(`${location.origin}/c/${c.id}`) },
    ],
    admin.webhookItems(c),
  ].filter(g => g.length)
// Admins drag channels within their section; the order is saved in channels.position.
const textList = ref<HTMLElement>()
const voiceList = ref<HTMLElement>()
// Only admins' rows carry data-drag (the whole row is the handle), so nobody else can start a drag. Sortable moves the DOM node itself: put it back, the refetch re-renders in the new order.
const sortable = (el: Ref<HTMLElement | undefined>, type: 'text' | 'voice') =>
  useSortable(el, [] as string[], {
    animation: 150,
    handle: '[data-drag]',
    // Member rows inside a channel li are HTML5-draggable themselves; keep Sortable off them and don't cancel their native drag.
    filter: '[data-member]',
    preventOnFilter: false,
    delay: 200,
    delayOnTouchOnly: true,
    watchElement: true,
    onUpdate: (e: { item: HTMLElement; from: HTMLElement; oldIndex?: number; newIndex?: number }) => {
      removeNode(e.item)
      insertNodeAt(e.from, e.item, e.oldIndex!)
      const ids = (type === 'text' ? textChannels : voiceChannels).value.map(c => c.id)
      ids.splice(e.newIndex!, 0, ...ids.splice(e.oldIndex!, 1))
      void admin.reorder(type, ids)
    },
  })
sortable(textList, 'text')
sortable(voiceList, 'voice')
// Admins drag a person onto another voice channel (native DnD, separate from the channel reorder above).
const dragged = ref<{ id: string; from: string }>()
const dropTarget = ref<string>()
const onMemberDragStart = (event: DragEvent, id: string, from: string) => {
  if (!admin.isAdmin.value || (id === me.value?.id && from === voice.pendingChannelId.value)) {
    event.preventDefault()
    return
  }
  const row = event.currentTarget as HTMLElement
  const rect = row.getBoundingClientRect()
  event.dataTransfer?.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top)
  dragged.value = { id, from }
}
const canDrop = (channelId: string) => admin.isAdmin.value && !!dragged.value && dragged.value.from !== channelId
const onDrop = (channelId: string) => {
  const d = dragged.value
  dropTarget.value = dragged.value = undefined
  if (admin.isAdmin.value && d && d.from !== channelId) void admin.move(d.id, channelId)
}
</script>

<template>
  <div class="@container/sidebar flex h-full flex-col">
    <!-- Mobile: the bottom margin separates the scrolling list from the voice and user cards. -->
    <nav class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 max-lg:mb-2">
      <!-- h-12 matching the header, minus nav padding and gap, so the first card lines up with the main panel. On mobile the logo sits in the drawer header (default layout). -->
      <div class="-mt-2 -mb-2 flex h-12 shrink-0 items-center justify-center px-2 text-2xl font-bold text-primary max-lg:hidden">spk</div>

      <section class="rounded-lg bg-(--ui-bg-panel) p-1">
        <h2 class="flex h-8 items-center gap-1.5 px-2 text-sm font-semibold text-muted compact:h-6">
          <UIcon name="i-lucide-message-circle" class="size-4" aria-hidden="true" />Direct messages
        </h2>
        <ul class="py-1 compact:py-0">
          <li v-for="p in people" :key="p.user.id">
            <UserContext
              :user-id="p.user.id"
              :extra="p.dm ? [{ label: 'Mark read', icon: 'i-lucide-check-check', onSelect: () => readNow(p.dm!.id) }, muteItem(p.dm.id)] : []"
            >
              <UButton
                :label="p.user.displayName!"
                :color="p.dm && route.params.channelId === p.dm.id ? 'primary' : 'neutral'"
                :variant="p.dm && route.params.channelId === p.dm.id ? 'soft' : 'ghost'"
                block
                class="justify-start compact:py-1"
                :class="[
                  p.dm && unreadOf(p.dm.id).unread ? 'bg-primary/10 font-bold text-highlighted hover:bg-primary/15' : '',
                  p.dm && isMuted(p.dm.id) ? 'opacity-50' : '',
                ]"
                @click="openDm(p)"
              >
                <EmojiText :text="p.user.displayName!" data-slot="label" class="truncate" />
                <template #leading>
                  <UAvatar :src="avatarSrc(p.user)" :alt="p.user.displayName!" size="2xs" :chip="presenceChip(p.user.id)" />
                </template>
                <template v-if="p.dm" #trailing>
                  <UBadge
                    v-if="unreadOf(p.dm.id).mentions"
                    icon="i-lucide-at-sign"
                    :label="String(unreadOf(p.dm.id).mentions)"
                    color="primary"
                    size="sm"
                    class="ml-auto"
                    aria-label="Mentions"
                  />
                  <UBadge
                    v-if="unreadOf(p.dm.id).unread"
                    :label="String(unreadOf(p.dm.id).unread)"
                    color="primary"
                    variant="subtle"
                    size="sm"
                    :class="{ 'ml-auto': !unreadOf(p.dm.id).mentions }"
                    aria-label="Unread messages"
                  />
                </template>
              </UButton>
            </UserContext>
          </li>
        </ul>
      </section>

      <section class="rounded-lg bg-(--ui-bg-panel) p-1">
        <div class="flex h-8 items-center justify-between pl-2 compact:h-6">
          <h2 class="flex items-center gap-1.5 text-sm font-semibold text-muted">
            <UIcon name="i-lucide-hash" class="size-4" aria-hidden="true" />Text channels
          </h2>
          <UButton
            v-if="admin.isAdmin.value"
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            aria-label="New text channel"
            @click="admin.dialog.value = { kind: 'create', type: 'text' }"
          />
        </div>
        <ul ref="textList" class="py-1 compact:py-0">
          <li v-for="c in textChannels" :key="c.id" :data-drag="admin.isAdmin.value || undefined">
            <UContextMenu :items="channelMenu(c) as never">
              <UButton
                :to="`/c/${c.id}`"
                :label="c.name ?? ''"
                :color="route.params.channelId === c.id ? 'primary' : 'neutral'"
                :variant="route.params.channelId === c.id ? 'soft' : 'ghost'"
                block
                class="justify-start compact:py-1"
                :class="[
                  unreadOf(c.id).unread ? 'font-bold text-highlighted' : '',
                  unreadOf(c.id).mentions ? 'bg-primary/10 hover:bg-primary/15' : '',
                  isMuted(c.id) ? 'opacity-50' : '',
                ]"
              >
                <EmojiText :text="c.name ?? ''" data-slot="label" class="truncate" />
                <template #trailing>
                  <UBadge
                    v-if="unreadOf(c.id).mentions"
                    icon="i-lucide-at-sign"
                    :label="String(unreadOf(c.id).mentions)"
                    color="primary"
                    size="sm"
                    class="ml-auto"
                    aria-label="Mentions"
                  />
                  <UBadge
                    v-if="unreadOf(c.id).unread"
                    :label="String(unreadOf(c.id).unread)"
                    color="primary"
                    variant="subtle"
                    size="sm"
                    :class="{ 'ml-auto': !unreadOf(c.id).mentions }"
                    aria-label="Unread messages"
                  />
                </template>
              </UButton>
            </UContextMenu>
          </li>
        </ul>
      </section>

      <section class="rounded-lg bg-(--ui-bg-panel) p-1">
        <div class="flex h-8 items-center justify-between pl-2 compact:h-6">
          <h2 class="flex items-center gap-1.5 text-sm font-semibold text-muted">
            <UIcon name="i-lucide-volume-2" class="size-4" aria-hidden="true" />Voice channels
          </h2>
          <UButton
            v-if="admin.isAdmin.value"
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            aria-label="New voice channel"
            @click="admin.dialog.value = { kind: 'create', type: 'voice' }"
          />
        </div>
        <ul ref="voiceList" class="py-1 compact:py-0">
          <li
            v-for="c in voiceChannels"
            :key="c.id"
            :data-drag="admin.isAdmin.value || undefined"
            @dragover="canDrop(c.id) && ($event.preventDefault(), (dropTarget = c.id))"
            @dragleave="dropTarget === c.id && !($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node) && (dropTarget = undefined)"
            @drop.prevent="onDrop(c.id)"
          >
            <div
              class="group/row flex items-center rounded-md"
              :class="dropTarget === c.id ? 'bg-amber-500/10' : route.params.channelId === c.id ? 'bg-primary/10' : 'hover:bg-elevated'"
            >
              <UContextMenu :items="channelMenu(c) as never" class="min-w-0 flex-1">
                <UButton
                  :to="`/c/${c.id}`"
                  :label="c.name ?? ''"
                  :color="route.params.channelId === c.id ? 'primary' : 'neutral'"
                  variant="ghost"
                  block
                  class="justify-start hover:bg-transparent compact:py-1"
                >
                  <EmojiText :text="c.name ?? ''" data-slot="label" class="truncate" />
                </UButton>
              </UContextMenu>
              <RadioIndicator :channel-id="c.id" :station="radioDirectory[c.id]" />
              <UTooltip v-if="voice.channelId.value === c.id" text="Leave voice">
                <UButton icon="i-lucide-phone-off" color="error" variant="link" aria-label="Leave voice" class="self-stretch" @click="voice.leave()" />
              </UTooltip>
              <UTooltip v-else-if="voice.pendingChannelId.value === c.id || voice.rejoining.value === c.id" text="Cancel voice join">
                <UButton icon="i-lucide-x" color="neutral" variant="link" aria-label="Cancel voice join" @click="voice.leave(false)" />
              </UTooltip>
              <UTooltip v-else :text="`Join ${c.name}`">
                <template #content="{ ui }"><EmojiText :text="`Join ${c.name}`" :class="ui.text()" /></template>
                <UButton
                  icon="i-lucide-phone"
                  color="neutral"
                  variant="link"
                  :aria-label="`Join ${c.name}`"
                  class="self-stretch opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100"
                  :class="route.params.channelId === c.id ? '[@media(hover:none)]:opacity-100' : ''"
                  @click="voice.join(c.id)"
                />
              </UTooltip>
            </div>
            <ul class="ml-7">
              <UserContext v-for="m in voiceDisplayMembers(c.id, me?.id)" :key="m.userId" :user-id="m.userId" :disabled="m.pending">
                <li
                  class="relative flex min-h-9 items-center gap-2 py-0.5 text-sm text-muted before:absolute before:top-0 before:-left-3 before:h-1/2 before:w-2.5 before:rounded-bl-md before:border-b-2 before:border-l-2 before:border-default after:absolute after:inset-y-0 after:-left-3 after:border-l-2 after:border-default last:after:hidden"
                  data-member
                  :class="(m.pending || voice.unheard.value.has(m.userId)) && 'opacity-50'"
                  :draggable="admin.isAdmin.value && !m.pending"
                  @dragstart="onMemberDragStart($event, m.userId, c.id)"
                  @dragend="dragged = dropTarget = undefined"
                >
                  <UAvatar
                    :src="avatarSrc(byId.get(m.userId))"
                    :alt="nameOf(m.userId)"
                    size="3xs"
                    :chip="presenceChip(m.userId)"
                    class="ring-2 transition"
                    :class="m.speaking ? 'ring-success' : 'ring-transparent'"
                  />
                  <span class="truncate"><EmojiText :text="nameOf(m.userId)" /></span>
                  <span v-if="m.pending || voice.unheard.value.has(m.userId)" role="status" class="text-xs">Connecting…</span>
                  <UTooltip v-if="m.screen" :text="`Watch ${nameOf(m.userId)}'s stream`" class="ml-auto">
                    <template #content="{ ui }"><EmojiText :text="`Watch ${nameOf(m.userId)}'s stream`" :class="ui.text()" /></template>
                    <UButton
                      icon="i-lucide-screen-share"
                      color="primary"
                      variant="ghost"
                      :aria-label="`Watch ${nameOf(m.userId)}'s stream`"
                      @click="voice.watchStream(c.id, m.userId)"
                    />
                  </UTooltip>
                  <UTooltip v-if="m.cam" :text="`Watch ${nameOf(m.userId)}'s camera`" :class="m.screen ? '' : 'ml-auto'">
                    <template #content="{ ui }"><EmojiText :text="`Watch ${nameOf(m.userId)}'s camera`" :class="ui.text()" /></template>
                    <UButton
                      icon="i-lucide-video"
                      color="primary"
                      variant="ghost"
                      :aria-label="`Watch ${nameOf(m.userId)}'s camera`"
                      @click="voice.watchStream(c.id, m.userId)"
                    />
                  </UTooltip>
                  <UTooltip v-if="m.radioListening" text="Listening to radio" :class="m.screen || m.cam ? '' : 'ml-auto'">
                    <UButton as="span" icon="i-lucide-radio" color="primary" variant="ghost" aria-label="Listening to radio" />
                  </UTooltip>
                  <UIcon v-if="m.deafened" name="i-lucide-headphone-off" class="size-3.5 shrink-0 text-error" aria-label="Deafened" />
                  <UIcon v-else-if="m.muted" name="i-lucide-mic-off" class="size-3.5 shrink-0 text-error" aria-label="Muted" />
                </li>
              </UserContext>
            </ul>
          </li>
        </ul>
      </section>

      <section class="rounded-lg bg-(--ui-bg-panel) p-1">
        <div class="flex h-8 items-center justify-between pl-2 compact:h-6">
          <h2 class="flex items-center gap-1.5 text-sm font-semibold text-muted">
            <UIcon name="i-lucide-webhook" class="size-4" aria-hidden="true" />Webhooks
          </h2>
          <UButton icon="i-lucide-plus" color="neutral" variant="ghost" aria-label="New webhook" @click="admin.webhookDialog.value = { mode: 'create' }" />
        </div>
        <ul class="py-1 compact:py-0">
          <li v-if="!webhooks.length" class="px-2 py-1 text-xs text-muted">No webhooks yet</li>
          <li v-for="c in webhooks" :key="c.id">
            <UContextMenu :items="webhookMenu(c) as never">
              <UButton
                :to="`/c/${c.id}`"
                :label="c.name ?? ''"
                :icon="`i-lucide-${c.icon ?? 'webhook'}`"
                :color="route.params.channelId === c.id ? 'primary' : 'neutral'"
                :variant="route.params.channelId === c.id ? 'soft' : 'ghost'"
                block
                class="justify-start compact:py-1"
                :class="[unreadOf(c.id).unread ? 'font-bold text-highlighted' : '', isMuted(c.id) ? 'opacity-50' : '']"
              >
                <EmojiText :text="c.name ?? ''" data-slot="label" class="truncate" />
                <template #trailing>
                  <UIcon v-if="c.private" name="i-lucide-lock" class="ml-auto size-3.5 shrink-0 text-muted" aria-label="Private" />
                  <UBadge
                    v-if="unreadOf(c.id).unread"
                    :label="String(unreadOf(c.id).unread)"
                    color="primary"
                    variant="subtle"
                    size="sm"
                    :class="{ 'ml-auto': !c.private }"
                    aria-label="Unread messages"
                  />
                </template>
              </UButton>
            </UContextMenu>
          </li>
        </ul>
      </section>
    </nav>

    <div
      v-if="voice.channelId.value || joining"
      class="mx-2 mb-2 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg bg-(--ui-bg-panel) p-2"
    >
      <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <UIcon
          name="i-lucide-volume-2"
          class="size-4 shrink-0"
          :class="{ ok: 'text-success', unstable: 'text-warning', lost: 'text-error' }[voice.health.value]"
        />
        <NuxtLink v-if="voiceId" :to="`/c/${voiceId}`" class="truncate hover:underline"><EmojiText :text="voiceName ?? ''" /></NuxtLink>
        <span v-else class="truncate">Voice</span>
      </div>
      <div
        class="min-w-0 @min-[360px]/sidebar:col-start-1 @min-[360px]/sidebar:row-start-2"
        :class="joining ? 'col-start-1 row-start-2' : 'col-start-2 row-start-1'"
      >
        <VoiceConnectionPopover />
      </div>
      <UButton v-if="joining" label="Cancel" color="neutral" variant="outline" class="col-start-2 row-span-2 row-start-1" @click="voice.leave(false)" />
      <div
        v-else
        role="group"
        aria-label="Voice actions"
        class="col-span-2 row-start-2 flex shrink-0 items-center justify-center gap-1 @max-[272px]/sidebar:gap-0.5 @min-[360px]/sidebar:col-span-1 @min-[360px]/sidebar:col-start-2 @min-[360px]/sidebar:row-span-2 @min-[360px]/sidebar:row-start-1 @max-[272px]/sidebar:[&_button]:px-0.5"
      >
        <div role="group" aria-label="Video actions" class="flex shrink-0 items-center gap-1 @max-[272px]/sidebar:gap-0.5">
          <VoiceControl kind="camera" />
          <VoiceControl kind="screen" />
        </div>
        <div role="group" aria-label="Audio and leave actions" class="flex shrink-0 items-center gap-1 @max-[272px]/sidebar:gap-0.5">
          <RadioPopover />
          <SoundboardPopover />
          <VoiceControl kind="leave" />
        </div>
      </div>
    </div>

    <div v-if="voice.audioBlocked.value" role="status" class="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-(--ui-bg-panel) p-2">
      <UIcon name="i-lucide-volume-x" class="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">Audio blocked</span>
      <UButton label="Enable audio" size="sm" @click="voice.enableAudio()" />
    </div>

    <div v-if="me" class="mx-2 mb-2 flex shrink-0 items-center gap-1 rounded-lg bg-(--ui-bg-panel) p-2">
      <UDropdownMenu :items="statusMenu" :content="{ align: 'start', side: 'top' }" :ui="{ content: 'w-48' }">
        <UButton color="neutral" variant="ghost" class="shrink-0 p-1" aria-label="Set status">
          <UAvatar :src="avatarSrc(me)" :alt="me.displayName ?? ''" icon="i-lucide-user" size="sm" :chip="presenceChip(me.id)" />
        </UButton>
        <template v-for="s in ['online', 'away', 'busy', 'offline'] as const" :key="s" #[`${s}-leading`]>
          <span class="flex size-5 items-center justify-center"><span class="size-2.5 rounded-full" :class="DOT[s]" /></span>
        </template>
      </UDropdownMenu>
      <div class="min-w-0 flex-1 leading-tight">
        <span class="block truncate text-sm font-medium"><EmojiText :text="me.displayName ?? me.email" /></span>
        <span class="block truncate text-xs text-muted">{{
          presenceLabel(myStatus === 'online' ? presenceOf(me.id) : myStatus === 'away' ? 'idle' : myStatus)
        }}</span>
      </div>
      <VoiceControl kind="mic" />
      <VoiceControl kind="deafen" />
      <UTooltip text="Settings">
        <UButton icon="i-lucide-settings" color="neutral" variant="ghost" aria-label="Settings" @click="settingsTab = 'profile'" />
      </UTooltip>
    </div>
  </div>
</template>
