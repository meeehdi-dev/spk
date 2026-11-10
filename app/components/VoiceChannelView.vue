<script setup lang="ts">
const props = defineProps<{ channelId: string }>()
const v = useVoice()
const { data: channels } = useChannels()
const { data: users, byId } = useUsers()
const channel = computed(() => channels.value.find(c => c.id === props.channelId))
const members = computed(() => voiceMembers(props.channelId))
const here = computed(() => v.channelId.value === props.channelId)
void users
const theater = ref<string | null>(null)
const tiles = computed(() => here.value ? v.tiles.value : [])
const focused = computed(() => tiles.value.find(t => t.userId === theater.value))
const others = computed(() => tiles.value.filter(t => t !== focused.value))
const toggleTheater = (id: string) => { theater.value = theater.value === id ? null : id }
// Starting to watch someone puts their tile in theater mode.
watch(v.watching, (now, before) => {
  const added = now.find(id => !before.includes(id))
  if (added) theater.value = added
})
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto">
   <!-- my-auto centers the group but, unlike justify-center, still lets a tall group scroll from its top. -->
   <div class="flex w-full flex-col items-center gap-6 p-6" :class="focused ? 'min-h-0 flex-1' : 'my-auto'">
    <div class="flex flex-col items-center gap-2 text-center">
      <UIcon name="i-lucide-volume-2" class="size-8 text-muted" />
      <h2 class="text-lg font-bold">{{ channel?.name }}</h2>
      <p v-if="!members.length" class="text-sm text-muted">Nobody is here yet.</p>
    </div>

    <!-- In the channel: one tile per person, with the webcam / screen opt-in rules. Theater: one tile fills the panel, the rest sit in a strip below. -->
    <div v-if="here && tiles.length" class="flex w-full flex-col gap-3" :class="focused ? 'min-h-0 flex-1' : ''">
      <VoiceTile v-if="focused" :key="focused.userId" :tile="focused" theater class="min-h-0 flex-1" @theater="toggleTheater(focused.userId)" />
      <div :class="focused ? 'flex gap-3 overflow-x-auto p-1 [&>*]:w-48 [&>*]:shrink-0' : 'flex w-full flex-wrap justify-center gap-3 [&>*]:w-80 [&>*]:max-w-full'">
        <VoiceTile v-for="t in others" :key="t.userId" :tile="t" :theater="false" @theater="toggleTheater(t.userId)" />
      </div>
    </div>

    <ul v-else class="flex flex-wrap justify-center gap-4">
      <li v-for="m in members" :key="m.userId" class="flex w-36 flex-col items-center gap-2 rounded-lg border border-default p-4">
        <UAvatar :src="avatarSrc(byId.get(m.userId))" :alt="byId.get(m.userId)?.displayName ?? ''" size="3xl"
          class="ring-2 transition" :class="m.speaking ? 'ring-success' : 'ring-transparent'" />
        <span class="flex max-w-full items-center gap-1 text-sm">
          <span class="truncate">{{ byId.get(m.userId)?.displayName ?? 'Unknown user' }}</span>
          <UIcon v-if="m.deafened" name="i-lucide-headphone-off" class="size-4 shrink-0 text-error" aria-label="Deafened" />
          <UIcon v-else-if="m.muted" name="i-lucide-mic-off" class="size-4 shrink-0 text-error" aria-label="Muted" />
        </span>
      </li>
    </ul>

    <UButton v-if="!here" label="Join voice" icon="i-lucide-phone" :loading="v.connecting.value" @click="v.join(channelId)" />
    <UButton v-else label="Leave voice" icon="i-lucide-phone-off" color="error" variant="soft" @click="v.leave()" />
   </div>
  </div>
</template>
