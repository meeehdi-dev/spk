<script setup lang="ts">
import type { Embed } from '~~/shared/utils/embed'

const props = defineProps<{ embed: Embed }>()
const BORDER = { success: 'border-success', error: 'border-error', warning: 'border-warning', info: 'border-info', neutral: 'border-accented' } as const
const now = useTick(60_000)
const when = computed(() => (props.embed.timestamp ? Date.parse(props.embed.timestamp) : NaN))
const isUrl = (v: string) => /^https?:\/\/\S+$/.test(v)
// Long or URL values would wrap char-by-char in a narrow column, so they get a full row.
const wide = (f: NonNullable<Embed['fields']>[number]) => !f.inline || f.value.length > 40 || isUrl(f.value)
const description = shallowRef<Awaited<ReturnType<typeof parseChatMarkdown>>>()
watchEffect(async () => {
  description.value = props.embed.description ? await parseChatMarkdown(props.embed.description) : undefined
})
</script>

<template>
  <div
    class="mt-1 flex max-w-3xl flex-col gap-1 rounded-md border-l-4 bg-(--ui-bg-base) px-3 py-2 text-sm"
    :class="BORDER[embed.color ?? 'neutral']"
    data-embed
  >
    <a v-if="embed.title && embed.url" :href="embed.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-primary hover:underline">{{
      embed.title
    }}</a>
    <span v-else-if="embed.title" class="font-semibold">{{ embed.title }}</span>
    <div v-if="description" class="chat-body break-words">
      <Suspense><MDCRenderer :body="description" :data="{}" tag="div" /></Suspense>
    </div>
    <dl v-if="embed.fields?.length" class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-1">
      <div v-for="(f, i) in embed.fields" :key="i" :class="wide(f) ? 'col-span-full' : 'col-span-1'">
        <dt class="text-xs font-semibold text-muted">{{ f.name }}</dt>
        <dd class="break-words">
          <a v-if="isUrl(f.value)" :href="f.value" target="_blank" rel="noopener noreferrer" class="break-all text-primary hover:underline">{{ f.value }}</a>
          <template v-else>{{ f.value }}</template>
        </dd>
      </div>
    </dl>
    <div v-if="embed.footer || !Number.isNaN(when)" class="text-xs text-muted">
      {{ embed.footer }}<template v-if="embed.footer && !Number.isNaN(when)"> · </template
      ><time v-if="!Number.isNaN(when)" :datetime="embed.timestamp">{{ relativeTime(when, now.getTime()) }}</time>
    </div>
  </div>
</template>
