<script setup lang="ts">
const { data: me, refresh } = useMe()
const toast = useToast()
const nickname = ref(me.value?.displayName ?? '')
const nickError = ref('')
watch(me, (m) => { if (!nickname.value) nickname.value = m?.displayName ?? '' })
const pw = reactive({ currentPassword: '', newPassword: '' })
const pwError = ref('')

async function saveNickname() {
  nickError.value = ''
  try {
    await $fetch('/api/profile/nickname', { method: 'POST', body: { displayName: nickname.value } })
    await refresh()
    toast.add({ title: 'Nickname saved', icon: 'i-lucide-check' })
  } catch (e) {
    nickError.value = errorText(e, 'Could not save')
  }
}

async function changePassword() {
  pwError.value = ''
  const { error } = await authClient.changePassword({ ...pw, revokeOtherSessions: true })
  if (error) return void (pwError.value = error.message || 'Could not change password')
  pw.currentPassword = pw.newPassword = ''
  toast.add({ title: 'Password changed', icon: 'i-lucide-check' })
}

</script>

<template>
  <div class="flex flex-col gap-6">
    <UCard>
      <template #header><h2 class="font-bold">Profile</h2></template>
      <div class="flex flex-col gap-4">
        <AvatarPicker />
        <form class="flex items-end gap-2" @submit.prevent="saveNickname">
          <UFormField label="Nickname" hint="2 to 32 characters" :error="nickError" class="flex-1">
            <UInput v-model="nickname" minlength="2" maxlength="32" required class="w-full" />
          </UFormField>
          <UButton type="submit" label="Save" icon="i-lucide-check" />
        </form>
      </div>
    </UCard>
    <UCard>
      <template #header><h2 class="font-bold">Change password</h2></template>
      <form class="flex flex-col gap-3" @submit.prevent="changePassword">
        <UFormField label="Current password"><UInput v-model="pw.currentPassword" type="password" autocomplete="current-password" required class="w-full" /></UFormField>
        <UFormField label="New password" hint="At least 8 characters" :error="pwError">
          <UInput v-model="pw.newPassword" type="password" autocomplete="new-password" minlength="8" required class="w-full" />
        </UFormField>
        <UButton type="submit" label="Change password" icon="i-lucide-key-round" class="self-start" />
      </form>
    </UCard>
    <UButton label="Sign out" icon="i-lucide-log-out" color="neutral" variant="outline" class="self-start" @click="signOut" />
  </div>
</template>
