<script setup lang="ts">
// Can't be dismissed: shown until the user has a nickname.
const { refresh } = useMe()
const nickname = ref('')
const error = ref('')
const loading = ref(false)

async function save() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/profile/nickname', { method: 'POST', body: { displayName: nickname.value } })
    await refresh()
  } catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage || 'Could not save'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal :open="true" :dismissible="false" :close="false" title="Welcome to spk" description="Choose a nickname and, optionally, an avatar.">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <AvatarPicker />
        <UFormField label="Nickname" hint="2 to 32 characters" :error="error">
          <UInput v-model="nickname" minlength="2" maxlength="32" required autofocus class="w-full" />
        </UFormField>
        <UButton type="submit" label="Continue" icon="i-lucide-check" :loading="loading" block />
      </form>
    </template>
  </UModal>
</template>
