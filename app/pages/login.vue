<script setup lang="ts">
definePageMeta({ layout: 'blank' })
const state = reactive({ email: '', password: '' })
const toast = useToast()
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    const { error } = await authClient.signIn.email(state)
    if (error) throw error
    await refreshNuxtData('me')
    await navigateTo('/')
  } catch (e) {
    toast.add({ title: errorText(e, 'Sign-in failed'), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard variant="soft" class="w-full max-w-sm">
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
      <UButton type="submit" label="Sign in" icon="i-lucide-log-in" :loading="loading" block />
      <p class="text-xs text-muted">No account? You need an invite link from an admin.</p>
    </UForm>
  </UCard>
</template>
