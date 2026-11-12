<script setup lang="ts">
interface Row {
  id: string
  note: string | null
  createdAt: number
  expiresAt: number
  status: 'active' | 'used' | 'expired' | 'revoked'
  usedBy: { id: string; name: string } | null
}
const { data: rows, refresh } = await useFetch<Row[]>('/api/invites', { default: () => [] })
const toast = useToast()
const form = reactive({ note: '' })
const link = ref('')
const { copy } = useClipboard()
const colors = { active: 'success', used: 'neutral', expired: 'warning', revoked: 'error' } as const

async function create() {
  try {
    const r = await $fetch<{ url: string }>('/api/invites', { method: 'POST', body: form })
    link.value = r.url
    form.note = ''
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not create invite', description: errorText(e) || undefined, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function copyLink(text: string) {
  await copy(text)
  toast.add({ title: 'Copied', icon: 'i-lucide-check' })
}

async function revoke(id: string) {
  await $fetch(`/api/invites/${id}/revoke`, { method: 'POST' })
  await refresh()
}

const admin = useAdmin()
// Right-click an invite row: revoke, copy note, view the user who signed up.
const menu = (r: Row) => [
  ...(r.status === 'active' ? [{ label: 'Revoke', icon: 'i-lucide-ban', color: 'error' as const, onSelect: () => revoke(r.id) }] : []),
  ...(r.note ? [{ label: 'Copy note', icon: 'i-lucide-copy', onSelect: () => copyLink(r.note!) }] : []),
  ...(r.usedBy
    ? [
        {
          label: 'View user',
          icon: 'i-lucide-user',
          onSelect: () => {
            admin.dialog.value = { kind: 'profile', userId: r.usedBy!.id }
          },
        },
      ]
    : []),
]

const fmt = (d: number) => new Date(d).toLocaleString()
</script>

<template>
  <div class="flex flex-col gap-6">
    <UCard>
      <template #header>
        <h2 class="font-bold">Create invite</h2>
      </template>
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="create">
        <UFormField label="Note (optional)" class="min-w-48 flex-1">
          <UInput v-model="form.note" maxlength="200" class="w-full" />
        </UFormField>
        <UButton type="submit" label="Create" icon="i-lucide-mail-plus" />
      </form>
      <UAlert
        v-if="link"
        class="mt-4"
        color="success"
        variant="subtle"
        icon="i-lucide-link"
        title="Invite link (shown only once, valid 5 minutes)"
        :description="link"
      >
        <template #actions>
          <UButton label="Copy" icon="i-lucide-copy" color="neutral" variant="outline" @click="copyLink(link)" />
        </template>
      </UAlert>
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-bold">Invites</h2>
      </template>
      <p v-if="!rows.length" class="text-sm text-muted">No invites yet.</p>
      <ul class="divide-y divide-default">
        <UContextMenu v-for="r in rows" :key="r.id" :items="menu(r)" :disabled="!menu(r).length">
          <li class="flex flex-wrap items-center gap-2 py-2 text-sm">
            <UBadge :label="r.status" :color="colors[r.status]" variant="subtle" />
            <span class="min-w-0 flex-1 truncate"
              >{{ r.note || 'No note' }}
              <span class="text-xs text-muted">· expires {{ fmt(r.expiresAt) }}<template v-if="r.usedBy"> · used by {{ r.usedBy.name }}</template></span>
            </span>
            <UButton v-if="r.status === 'active'" label="Revoke" icon="i-lucide-ban" color="error" variant="ghost" @click="revoke(r.id)" />
          </li>
        </UContextMenu>
      </ul>
    </UCard>
  </div>
</template>
