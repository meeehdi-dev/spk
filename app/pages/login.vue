<script setup lang="ts">
definePageMeta({ layout: 'blank' })
const state = reactive({ email: '', password: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  const { error: e } = await authClient.signIn.email(state)
  loading.value = false
  if (e) return void (error.value = e.message || 'Sign-in failed')
  await refreshNuxtData('me')
  await navigateTo('/')
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <h1 class="font-bold">Sign in to spk</h1>
    </template>
    <UForm :state="state" class="flex flex-col gap-3" @submit="submit">
      <UFormField label="Email" name="email">
        <UInput v-model="state.email" type="email" autocomplete="email" required class="w-full" />
      </UFormField>
      <UFormField label="Password" name="password">
        <UInput v-model="state.password" type="password" autocomplete="current-password" required class="w-full" />
      </UFormField>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
      <UButton type="submit" label="Sign in" icon="i-lucide-log-in" :loading="loading" block />
      <p class="text-xs text-muted">No account? You need an invite link from an admin.</p>
    </UForm>
  </UCard>
</template>
