<script setup lang="ts">
import { presenceOf } from '~/composables/usePresence'
const admin = useAdmin()
const { byId, nameOf } = useUsers()
const { data: me } = useMe()
const d = admin.dialog
const open = computed({ get: () => !!d.value, set: (o) => { if (!o) d.value = null } })
const name = ref('')
const reason = ref('')
const busy = ref(false)
const kind = computed(() => d.value?.kind)
watch(d, (v) => { name.value = v?.kind === 'rename' ? (v.channel.name ?? '') : ''; reason.value = '' })

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  try { await fn(); d.value = null } catch (e) { admin.fail('Failed')(e) } finally { busy.value = false }
}
const submit = () => run(async () => {
  const v = d.value!
  if (v.kind === 'create') {
    const ch = await $fetch<{ id: string }>('/api/admin/channels', { method: 'POST', body: { type: v.type, name: name.value } })
    await refreshNuxtData('channels')
    await navigateTo(`/c/${ch.id}`)
  } else if (v.kind === 'rename') {
    await $fetch(`/api/admin/channels/${v.channel.id}`, { method: 'PATCH', body: { name: name.value } })
    await refreshNuxtData('channels')
  } else if (v.kind === 'delete') {
    await $fetch(`/api/admin/channels/${v.channel.id}`, { method: 'DELETE' })
    await refreshNuxtData('channels')
  } else if (v.kind === 'ban') {
    if (!await admin.setBanned(v.userId, true, reason.value)) throw new Error('Could not ban')
  }
})

// Profile: avatar, nickname, role, online status, Send DM. The email is for admins only.
const profile = computed(() => d.value?.kind === 'profile' ? byId.value.get(d.value.userId) : undefined)
const email = ref('')
watch(() => d.value?.kind === 'profile' ? d.value.userId : null, async (id) => {
  email.value = ''
  if (!id) return
  if (admin.isAdmin.value) email.value = (await $fetch<{ users: Array<{ id: string, email: string }> }>('/api/admin/users').catch(() => ({ users: [] }))).users.find(u => u.id === id)?.email ?? ''
})
const title = computed(() => ({ create: `New ${d.value && d.value.kind === 'create' ? d.value.type : ''} channel`, rename: 'Rename channel', delete: 'Delete channel', ban: 'Ban user', profile: 'Profile' } as Record<string, string>)[kind.value ?? ''] ?? '')
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="kind === 'profile' ? 'Who this is' : 'Admin action'">
    <template #body>
      <form v-if="kind === 'create' || kind === 'rename'" class="flex flex-col gap-3" @submit.prevent="submit">
        <UFormField label="Name"><UInput v-model="name" maxlength="32" autofocus class="w-full" /></UFormField>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton type="submit" :label="kind === 'create' ? 'Create' : 'Save'" icon="i-lucide-check" :loading="busy" />
        </div>
      </form>

      <div v-else-if="d?.kind === 'delete'" class="flex flex-col gap-3">
        <p class="text-sm">Delete <b>{{ d.channel.name }}</b>? Its messages and files are removed for everyone.<template v-if="d.channel.type === 'voice'"> People in it are disconnected.</template> This can't be undone.</p>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Delete" icon="i-lucide-trash-2" color="error" :loading="busy" @click="submit" />
        </div>
      </div>

      <div v-else-if="d?.kind === 'ban'" class="flex flex-col gap-3">
        <p class="text-sm">Ban <b>{{ nameOf(d.userId) }}</b>? They are signed out everywhere, removed from voice and can't sign in. Their messages stay. You can unban them later.</p>
        <UFormField label="Reason (optional)"><UInput v-model="reason" maxlength="200" class="w-full" /></UFormField>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Ban" icon="i-lucide-ban" color="error" :loading="busy" @click="submit" />
        </div>
      </div>

      <div v-else-if="d?.kind === 'profile' && profile" class="flex items-center gap-4">
        <UAvatar :src="avatarSrc(profile)" :alt="profile.displayName ?? ''" icon="i-lucide-user" size="3xl" :chip="presenceChip(profile.id)" />
        <div class="flex min-w-0 flex-col gap-1">
          <span class="truncate text-lg font-bold">{{ profile.displayName }}</span>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge :label="profile.role" :color="profile.role === 'admin' ? 'primary' : 'neutral'" variant="subtle" />
            <UBadge v-if="profile.banned" label="banned" color="error" variant="subtle" />
            <span class="flex items-center gap-1 text-xs text-muted"><span class="size-2 rounded-full" :class="{ online: 'bg-success', idle: 'bg-warning', offline: 'bg-neutral-400' }[presenceOf(profile.id)]" />{{ { online: 'Online', idle: 'Idle', offline: 'Offline' }[presenceOf(profile.id)] }}</span>
          </div>
          <span v-if="email" class="truncate text-xs text-muted">{{ email }}</span>
          <UButton v-if="me?.id !== profile.id" label="Send DM" icon="i-lucide-message-circle" size="sm" class="mt-1 w-fit" @click="open = false; openDmWith(profile.id)" />
        </div>
      </div>
    </template>
  </UModal>
</template>
