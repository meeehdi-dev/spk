<script setup lang="ts">
import { SHORTCUT_GROUPS } from '#shared/utils/shortcuts'
</script>

<template>
  <div class="flex flex-col gap-5">
    <section
      v-for="g in SHORTCUT_GROUPS"
      :key="g.title"
    >
      <h3 class="mb-2 text-xs font-bold text-muted uppercase">
        {{ g.title }}
      </h3>
      <ul class="flex flex-col gap-1.5">
        <li
          v-for="i in g.items"
          :key="i.label"
          class="flex items-center justify-between gap-4 text-sm"
          :class="i.planned ? 'opacity-50' : ''"
        >
          <span>{{ i.label }}</span>
          <span class="flex shrink-0 gap-1"><UKbd
            v-for="k in i.keys"
            :key="k"
            :value="k"
          /></span>
        </li>
      </ul>
    </section>
  </div>
</template>
