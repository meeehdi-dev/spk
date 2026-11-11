<script setup lang="ts">
definePageMeta({ layout: 'blank' })
const token = String(useRoute().query.token ?? '')
const { data: check } = await useFetch<{ valid: boolean }>('/api/reset-password/check', { query: { token } })
const password = ref('')
const error = ref('')
const loading = ref(false)
const done = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/reset-password', { method: 'POST', body: { token, password: password.value } })
    done.value = true
  } catch (e) {
    error.value = errorText(e, 'Could not reset the password')
  }
  loading.value = false
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <h1 class="font-bold">Reset your password</h1>
    </template>
    <UAlert
      v-if="done"
      color="success"
      variant="subtle"
      icon="i-lucide-check"
      title="Password changed"
      description="You were signed out everywhere. Sign in with the new password."
    >
      <template #actions>
        <UButton to="/login" label="Sign in" icon="i-lucide-log-in" />
      </template>
    </UAlert>
    <UAlert
      v-else-if="!check?.valid"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="This reset link is invalid, expired or already used"
      description="Ask an admin for a new link."
    />
    <UForm v-else :state="{ password }" class="flex flex-col gap-3" @submit="submit">
      <UFormField label="New password" name="password" hint="At least 8 characters">
        <UInput v-model="password" type="password" autocomplete="new-password" minlength="8" required class="w-full" />
      </UFormField>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
      <UButton type="submit" label="Set password" icon="i-lucide-key-round" :loading="loading" block />
    </UForm>
  </UCard>
</template>
