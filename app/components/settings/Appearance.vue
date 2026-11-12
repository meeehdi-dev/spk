<script setup lang="ts">
const density = useCookie<'comfortable' | 'compact'>('spk-density', { default: () => 'comfortable', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
const gifOnHover = useGifOnHover()
const colorMode = useColorMode()
const densities = [
  { value: 'comfortable', label: 'Comfortable', description: 'The default spacing.' },
  { value: 'compact', label: 'Compact', description: 'Tighter message, sidebar and voice panel spacing, to fit more on screen.' },
]
const themes = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
</script>

<template>
  <div class="flex flex-col gap-6">
    <UCard>
      <template #header>
        <h2 class="font-bold">Density</h2>
      </template>
      <URadioGroup v-model="density" :items="densities" legend="Density" />
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-bold">Theme</h2>
      </template>
      <URadioGroup v-model="colorMode.preference" :items="themes" legend="Theme" />
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-bold">Media</h2>
      </template>
      <USwitch v-model="gifOnHover" label="Play GIFs only on hover" description="GIFs in messages stay still until you hover or focus them." />
    </UCard>
  </div>
</template>
