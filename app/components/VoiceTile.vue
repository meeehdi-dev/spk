<script setup lang="ts">
import type { VoiceTile } from '~/composables/useVoice'

import { userVolume } from '#shared/utils/voice'

const props = defineProps<{ tile: VoiceTile; theater: boolean }>()
const emit = defineEmits<{ theater: [] }>()
const v = useVoice()
const admin = useAdmin()
const { byId, nameOf } = useUsers()
const root = ref<HTMLElement>()
const mainEl = ref<HTMLVideoElement>()
const cornerEl = ref<HTMLVideoElement>()
const preview = ref(false)
const hovered = ref(false)
const { toggle: fullscreen } = useFullscreen(root)

const screen = computed(() => (props.tile.screen && (!props.tile.local || preview.value) ? props.tile.screen : undefined))
const main = computed(() => screen.value ?? props.tile.cam)
const corner = computed(() => (screen.value && props.tile.cam ? props.tile.cam : undefined))
const live = computed(() => props.tile.camLive || props.tile.screenLive)
const mirrored = (t: unknown) => props.tile.local && t === props.tile.cam
// The tracks are attached to the <video> elements by hand; detached again when they change.
watchEffect(onCleanup => {
  const t = main.value,
    el = mainEl.value
  if (t && el) {
    t.attach(el)
    onCleanup(() => t.detach(el))
  }
})
watchEffect(onCleanup => {
  const t = corner.value,
    el = cornerEl.value
  if (t && el) {
    t.attach(el)
    onCleanup(() => t.detach(el))
  }
})

const vol = computed(() => userVolume(v.volumes.value, props.tile.userId))
const watchToggle = () => v.watch(props.tile.userId, !props.tile.watching)
const items = computed(() =>
  [
    [
      ...(props.tile.local
        ? props.tile.screenLive
          ? [
              {
                label: preview.value ? 'Hide preview' : 'Show preview',
                icon: 'i-lucide-eye',
                onSelect: () => {
                  preview.value = !preview.value
                },
              },
            ]
          : []
        : live.value
          ? [
              {
                label: props.tile.watching ? 'Stop watching' : 'Watch',
                icon: props.tile.watching ? 'i-lucide-eye-off' : 'i-lucide-eye',
                kbds: ['W'],
                onSelect: watchToggle,
              },
            ]
          : []),
      { label: props.theater ? 'Exit theater mode' : 'Theater mode', icon: 'i-lucide-rectangle-horizontal', kbds: ['T'], onSelect: () => emit('theater') },
      { label: 'Fullscreen', icon: 'i-lucide-maximize', kbds: ['F'], onSelect: () => fullscreen() },
    ],
    ...admin.userGroups(props.tile.userId),
  ].filter(g => g.length),
)

// T / F / W act on the hovered or focused tile, never while typing.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!(hovered.value || root.value?.contains(document.activeElement)) || e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target as HTMLElement
  if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
  const k = e.key.toLowerCase()
  if (k === 't') emit('theater')
  else if (k === 'f') void fullscreen()
  else if (k === 'w' && !props.tile.local && live.value) watchToggle()
  else return
  e.preventDefault()
})
</script>

<template>
  <UContextMenu :items="items as never">
    <div
      ref="root"
      tabindex="0"
      class="group relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-default bg-elevated/40 ring-2 transition outline-none focus-visible:ring-primary"
      :class="tile.speaking ? 'ring-success' : 'ring-transparent'"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @dblclick="fullscreen()"
    >
      <video
        v-show="main"
        ref="mainEl"
        autoplay
        playsinline
        muted
        class="size-full"
        :class="[screen ? 'object-contain' : 'object-cover', mirrored(main) ? '-scale-x-100' : '']"
      />
      <video
        v-show="corner"
        ref="cornerEl"
        autoplay
        playsinline
        muted
        class="absolute top-10 right-2 h-1/4 min-h-16 rounded-md border border-default object-cover"
        :class="tile.local ? '-scale-x-100' : ''"
      />

      <div v-if="!main" class="flex flex-col items-center gap-2">
        <UAvatar :src="avatarSrc(byId.get(tile.userId))" :alt="nameOf(tile.userId)" size="3xl" />
        <template v-if="tile.local && tile.screenLive">
          <p class="text-sm">You're sharing your screen</p>
          <UButton label="Stop" icon="i-lucide-monitor-off" color="error" size="xs" @click="v.stopScreen()" />
        </template>
        <UButton v-else-if="!tile.local && live && !tile.watching" label="Watch" icon="i-lucide-eye" size="xs" @click="watchToggle" />
      </div>

      <span class="absolute top-2 left-2 flex max-w-[70%] items-center gap-1.5 rounded bg-default/80 px-1.5 py-0.5 text-xs">
        <span class="truncate">{{ tile.local ? 'You' : nameOf(tile.userId) }}</span>
        <UBadge v-if="!tile.watching && live" :icon="tile.screenLive ? 'i-lucide-screen-share' : 'i-lucide-video'" label="LIVE" color="error" size="sm" />
      </span>

      <div class="absolute top-2 right-2 flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        <UTooltip v-if="!tile.local && live && tile.watching" text="Stop watching" :kbds="['W']">
          <UButton icon="i-lucide-eye-off" color="neutral" variant="solid" size="xs" aria-label="Stop watching" @click="watchToggle" />
        </UTooltip>
        <UTooltip :text="theater ? 'Exit theater mode' : 'Theater mode'" :kbds="['T']">
          <UButton icon="i-lucide-rectangle-horizontal" color="neutral" variant="solid" size="xs" aria-label="Theater mode" @click="emit('theater')" />
        </UTooltip>
        <UTooltip text="Fullscreen" :kbds="['F']">
          <UButton icon="i-lucide-maximize" color="neutral" variant="solid" size="xs" aria-label="Fullscreen" @click="fullscreen()" />
        </UTooltip>
      </div>

      <!-- Screen audio volume: same setting as the menus. Only on a watched screen share that has audio. -->
      <UPopover v-if="!tile.local && tile.watching && tile.screenAudio">
        <UButton
          icon="i-lucide-volume-2"
          color="neutral"
          variant="solid"
          size="xs"
          aria-label="Screen share volume"
          class="absolute right-2 bottom-2 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100"
        />
        <template #content>
          <div class="w-48 p-3">
            <USlider
              :model-value="vol.screen"
              :min="0"
              :max="1"
              :step="0.05"
              aria-label="Screen share volume"
              @update:model-value="v.setVolume(tile.userId, { screen: $event as number })"
            />
          </div>
        </template>
      </UPopover>
    </div>
  </UContextMenu>
</template>
