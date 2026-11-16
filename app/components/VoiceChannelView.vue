<script setup lang="ts">
const props = defineProps<{ channelId: string }>()
const v = useVoice()
const { data: users, byId } = useUsers()
const members = computed(() => voiceDisplayMembers(props.channelId, v.me.value?.id))
const pending = computed(() => v.pendingChannelId.value === props.channelId)
const here = computed(() => v.channelId.value === props.channelId)
void users.value
const theater = v.theater
const tiles = computed(() => (here.value ? v.tiles.value : []))
const focused = computed(() => tiles.value.find(t => t.userId === theater.value))
const others = computed(() => tiles.value.filter(t => t !== focused.value))
const participantsHidden = ref(false)
const participantsId = useId()
const participantsLabel = computed(() => (participantsHidden.value ? 'Show participants' : 'Hide participants'))
watch(focused, tile => {
  if (!tile) participantsHidden.value = false
})
const toggleTheater = (id: string) => {
  theater.value = theater.value === id ? null : id
}
</script>

<template>
  <div class="relative flex h-full flex-col">
    <p
      v-if="here && v.connectionLabel.value !== 'Connected'"
      role="status"
      class="pointer-events-none absolute inset-x-2 top-2 z-10 mx-auto w-fit max-w-[calc(100%_-_1rem)] rounded bg-default/90 px-2 py-1 text-sm text-muted"
    >
      {{ v.connectionLabel.value }}
    </p>
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <!-- my-auto centers the group but, unlike justify-center, still lets a tall group scroll from its top. -->
      <div class="flex w-full flex-col items-center gap-6 p-6 compact:gap-3 compact:p-3" :class="focused ? 'min-h-0 flex-1' : 'my-auto'">
        <p v-if="!members.length" class="text-sm text-muted">Nobody is here yet.</p>

        <!-- In the channel: one tile per person, with the webcam / screen opt-in rules. Theater: one tile fills the panel, the rest sit in a strip below. -->
        <div v-if="here && tiles.length" class="flex w-full flex-col gap-3" :class="focused ? 'min-h-0 flex-1' : ''">
          <VoiceTile v-if="focused" :key="focused.userId" :tile="focused" theater class="min-h-0 flex-1" @theater="toggleTheater(focused.userId)" />
          <div
            v-show="!focused || !participantsHidden"
            :id="participantsId"
            :class="
              focused
                ? 'flex justify-center-safe gap-3 overflow-x-auto p-1 [&>*]:w-48 [&>*]:shrink-0'
                : 'flex w-full flex-wrap justify-center gap-3 [&>*]:w-80 [&>*]:max-w-full'
            "
          >
            <VoiceTile v-for="t in others" :key="t.userId" :tile="t" :theater="false" @theater="toggleTheater(t.userId)" />
          </div>
        </div>

        <ul v-else class="flex flex-wrap justify-center gap-4">
          <li
            v-for="m in members"
            :key="m.userId"
            class="relative flex w-36 flex-col items-center gap-2 rounded-lg border border-default p-4"
            :class="m.pending && 'opacity-50'"
          >
            <UAvatar
              :src="avatarSrc(byId.get(m.userId))"
              :alt="byId.get(m.userId)?.displayName ?? ''"
              size="3xl"
              class="ring-2 transition"
              :class="m.speaking ? 'ring-success' : 'ring-transparent'"
            />
            <span class="flex max-w-full items-center gap-1 text-sm">
              <span class="truncate"><EmojiText :text="byId.get(m.userId)?.displayName ?? 'Unknown user'" /></span>
              <UIcon v-if="m.deafened" name="i-lucide-headphone-off" class="size-4 shrink-0 text-error" aria-label="Deafened" />
              <UIcon v-else-if="m.muted" name="i-lucide-mic-off" class="size-4 shrink-0 text-error" aria-label="Muted" />
            </span>
            <span v-if="m.pending" role="status" class="text-sm text-muted">Connecting…</span>
            <Transition leave-active-class="transition-opacity duration-300 motion-reduce:transition-none" leave-to-class="opacity-0">
              <div v-if="v.playing.value[m.userId]" class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-default/70">
                <UIcon :name="v.playing.value[m.userId]!" class="size-12 text-primary" />
              </div>
            </Transition>
          </li>
        </ul>
      </div>
    </div>

    <div
      class="mx-2 mb-2 flex w-fit max-w-[calc(100%_-_1rem)] shrink-0 flex-wrap items-center justify-center gap-2 self-center"
      :class="here && 'rounded-lg bg-elevated/50 p-2'"
    >
      <UButton v-if="pending" label="Cancel" color="neutral" variant="outline" @click="v.leave(false)" />
      <UButton v-else-if="!here" label="Join voice" icon="i-lucide-phone" :loading="v.connecting.value" @click="v.join(channelId)" />
      <template v-else>
        <VoiceControl kind="mic" labeled />
        <VoiceControl kind="deafen" labeled />
        <VoiceControl kind="camera" labeled />
        <VoiceControl kind="screen" labeled />
        <RadioPopover labeled />
        <SoundboardPopover labeled />
        <VoiceControl kind="leave" labeled />
        <UTooltip v-if="focused" :text="participantsLabel">
          <UButton
            :icon="participantsHidden ? 'i-lucide-panel-bottom-open' : 'i-lucide-panel-bottom-close'"
            :label="participantsLabel"
            color="neutral"
            variant="ghost"
            :aria-label="participantsLabel"
            :aria-expanded="!participantsHidden"
            :aria-controls="participantsId"
            @click="participantsHidden = !participantsHidden"
          />
        </UTooltip>
      </template>
    </div>
  </div>
</template>
