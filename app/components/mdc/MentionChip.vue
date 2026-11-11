<script setup lang="ts">
const props = defineProps<{ uid: string }>()
const { byId } = useUsers()
const { data: me } = useMe()
const admin = useAdmin()
const name = computed(() => byId.value.get(props.uid)?.displayName || 'Unknown user')
const el = ref<HTMLElement>()
onMounted(() => {
  registerCtx(el.value, {
    kind: 'mention',
    items: () => admin.userGroups(props.uid).flat(),
  })
})
</script>

<template>
  <span ref="el" class="rounded px-1 font-medium" :class="me?.id === uid ? 'bg-primary/20 text-primary' : 'bg-elevated text-primary'">@{{ name }}</span>
</template>
