<script setup lang="ts">
definePageMeta({ layout: 'blank' })
const token = String(useRoute().query.invite ?? '')
const { data: check } = await useFetch('/api/invites/check', { query: { token } })
const state = reactive({ email: '', password: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  const { error: e } = await authClient.signUp.email(
    { email: state.email, password: state.password, name: state.email.split('@')[0]! },
    { headers: { 'x-invite-token': token } },
  )
  loading.value = false
  if (e) return void (error.value = e.message || 'Sign-up failed')
  await refreshNuxtData('me')
  await navigateTo('/')
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <h1 class="font-bold">Create your spk account</h1>
    </template>
    <UAlert v-if="!token" color="warning" variant="subtle" icon="i-lucide-ticket" title="You need an invite link" description="Ask an admin for one." />
    <UAlert
      v-else-if="!check?.valid"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="`This invite is ${check?.reason ?? 'invalid'}`"
      description="Ask an admin for a new link."
    />
    <UForm v-else :state="state" class="flex flex-col gap-3" @submit="submit">
      <UFormField label="Email" name="email">
        <UInput v-model="state.email" type="email" autocomplete="email" required class="w-full" />
      </UFormField>
      <UFormField label="Password" name="password" hint="At least 8 characters">
        <UInput v-model="state.password" type="password" autocomplete="new-password" minlength="8" required class="w-full" />
      </UFormField>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
      <UButton type="submit" label="Create account" icon="i-lucide-user-plus" :loading="loading" block />
    </UForm>
  </UCard>
</template>
