<script setup lang="ts">
interface Row { id: string, email: string, displayName: string | null, avatarKey: string | null, role: 'admin' | 'user', banned: boolean, createdAt: number, bytes: number }
const { data, refresh } = await useFetch<{ users: Row[], totalBytes: number }>('/api/admin/users', { default: () => ({ users: [], totalBytes: 0 }) })
const { data: me } = useMe()
const admin = useAdmin()
const link = ref<{ name: string, url: string } | null>(null)
const size = (n: number) => formatBytes(n)

// The sidebar's `users:changed` refresh updates the directory; keep this table in step.
useSocket().on((m) => {
  if (m.type === 'users:changed')
    void refresh()
})

async function resetLink(u: Row) {
  try {
    const r = await $fetch<{ url: string }>(`/api/admin/users/${u.id}/reset-link`, { method: 'POST' })
    link.value = { name: u.displayName || u.email, url: r.url }
  } catch (e) { admin.fail('Could not create the link')(e) }
}
async function copyLink() {
  await copyText(link.value!.url)
}

const items = (u: Row) => [
  [{ label: 'Profile', icon: 'i-lucide-user', onSelect: () => { admin.dialog.value = { kind: 'profile', userId: u.id } } }],
  [
    { label: 'Make user', icon: 'i-lucide-user', disabled: u.role !== 'admin', onSelect: async () => {
      await admin.setRole(u.id, 'user')
      await refresh()
    } },
    { label: 'Make admin', icon: 'i-lucide-shield-check', disabled: u.role === 'admin', onSelect: async () => {
      await admin.setRole(u.id, 'admin')
      await refresh()
    } },
    { label: 'Reset password', icon: 'i-lucide-key-round', onSelect: () => resetLink(u) },
  ],
  [u.banned
    ? { label: 'Unban', icon: 'i-lucide-user-check', onSelect: async () => {
        await admin.setBanned(u.id, false)
        await refresh()
      } }
    : { label: 'Ban', icon: 'i-lucide-ban', color: 'error' as const, disabled: u.id === me.value?.id, onSelect: () => { admin.dialog.value = { kind: 'ban', userId: u.id } } }],
]
</script>

<template>
  <div class="flex flex-col gap-6">
    <UCard>
      <template #header>
        <h2 class="font-bold">
          Storage
        </h2>
      </template>
      <p class="text-sm">
        Files stored in R2 (attachments and sounds): <b>{{ size(data.totalBytes) }}</b>
      </p>
      <p class="text-xs text-muted">
        Avatars and link thumbnails are small and not counted.
      </p>
    </UCard>

    <UAlert
      v-if="link"
      color="success"
      variant="subtle"
      icon="i-lucide-key-round"
      :title="`Reset link for ${link.name} (shown only once, valid 24 hours, one use)`"
      :description="link.url"
    >
      <template #actions>
        <UButton
          label="Copy"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          @click="copyLink"
        />
      </template>
    </UAlert>

    <UCard>
      <template #header>
        <h2 class="font-bold">
          Users
        </h2>
      </template>
      <ul class="divide-y divide-default">
        <li
          v-for="u in data.users"
          :key="u.id"
          class="flex flex-wrap items-center gap-2 py-2 text-sm"
        >
          <UserContext
            :user-id="u.id"
            class="min-w-0 flex-1"
          >
            <div class="flex min-w-0 items-center gap-2">
              <UAvatar
                :src="avatarSrc(u)"
                :alt="u.displayName ?? ''"
                icon="i-lucide-user"
                size="sm"
                :chip="presenceChip(u.id)"
              />
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ u.displayName || 'No nickname yet' }}</span>
                <span class="block truncate text-xs text-muted">{{ u.email }} · {{ size(u.bytes) }}</span>
              </span>
            </div>
          </UserContext>
          <UBadge
            :label="u.role"
            :color="u.role === 'admin' ? 'primary' : 'neutral'"
            variant="subtle"
          />
          <UBadge
            v-if="u.banned"
            label="banned"
            color="error"
            variant="subtle"
          />
          <UDropdownMenu :items="items(u) as never">
            <UButton
              icon="i-lucide-ellipsis"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Actions for ${u.displayName || u.email}`"
            />
          </UDropdownMenu>
        </li>
      </ul>
    </UCard>
  </div>
</template>
