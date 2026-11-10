<script setup lang="ts">
// Cookie so the server renders the density on <html> with no flash.
const density = useCookie<'comfortable' | 'compact'>('spk-density', { default: () => 'comfortable', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
useHead({ htmlAttrs: { 'data-density': density } })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
