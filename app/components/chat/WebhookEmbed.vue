<script setup lang="ts">
import type { Embed } from '~~/shared/utils/embed'

const props = defineProps<{ embed: Embed }>()
const BORDER = { success: 'border-success', error: 'border-error', warning: 'border-warning', info: 'border-info', neutral: 'border-accented' } as const
const now = useTick(60_000)
const when = computed(() => (props.embed.timestamp ? Date.parse(props.embed.timestamp) : NaN))
// Visible text of a markdown value: link targets don't take up space.
const visible = (v: string) => v.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replaceAll('`', '')
// Long or URL values would wrap char-by-char in a narrow column, so they get a full row.
const wide = (f: NonNullable<Embed['fields']>[number]) => !f.inline || visible(f.value).length > 40 || /^https?:\/\/\S+$/.test(f.value)
type Parsed = Awaited<ReturnType<typeof parseChatMarkdown>>
const description = shallowRef<Parsed>()
const fields = shallowRef<(Parsed | undefined)[]>([])
const avatarFailed = ref(false)
watchEffect(async () => {
  const { description: d, fields: f = [] } = props.embed
  const [desc, ...values] = await Promise.all([d ? parseChatMarkdown(d) : undefined, ...f.map(x => parseChatMarkdown(x.value))])
  description.value = desc
  fields.value = values
})
</script>

<template>
  <div
    class="mt-1 flex max-w-3xl flex-col gap-1 rounded-md border-l-4 bg-(--ui-bg-base) px-3 py-2 text-sm"
    :class="BORDER[embed.color ?? 'neutral']"
    data-embed
  >
    <div v-if="embed.author" class="flex items-center gap-1.5 text-xs font-semibold" data-embed-author>
      <img
        v-if="embed.author.icon && !avatarFailed"
        :src="embed.author.icon"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        class="size-5 rounded-full"
        @error="avatarFailed = true"
      />
      <a v-if="embed.author.url" :href="embed.author.url" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ embed.author.name }}</a>
      <span v-else>{{ embed.author.name }}</span>
    </div>
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
        <dd class="chat-body break-words">
          <Suspense v-if="fields[i]"><MDCRenderer :body="fields[i]" :data="{}" tag="div" /></Suspense>
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
