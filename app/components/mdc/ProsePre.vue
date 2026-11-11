<script setup lang="ts">
const props = defineProps<{ code?: string, language?: string | null, class?: string | null }>()
const ctx = inject(messageCtxKey, null)

const code = computed(() => (props.code ?? '').replace(/\n$/, ''))
const lines = computed(() => code.value.split('\n').length)
const explicit = computed(() => !!props.class?.includes('language-'))
const detected = computed(() => explicit.value ? null : detectLanguage(code.value))
// Language the reader picked: on your own message it is saved as an edit, otherwise it only changes your screen.
const picked = ref<string>()
async function pick(l: string) {
  picked.value = l
  const body = root.value?.closest('[data-body]')
  if (!ctx?.own || !body) return
  const same = [...body.querySelectorAll('[data-codeblock]')].filter(el => (el as HTMLElement).dataset.codeblock === code.value)
  if (!await ctx.setLanguage(same.indexOf(root.value!), l, code.value)) {
    useToast().add({ title: 'Could not save the language, changed on your screen only', color: 'warning', icon: 'i-lucide-info' })
  }
}
const lang = computed(() => picked.value ?? (explicit.value ? props.language! : detected.value) ?? 'text')

const huge = computed(() => lines.value > PLAIN_ABOVE_LINES)
const forced = ref(false)
const html = ref('')
watchEffect(async () => {
  const c = code.value
  const l = lang.value
  html.value = plainHtml(c)
  if (!import.meta.client || l === 'text' || (huge.value && !forced.value)) return
  const out = await highlightToHtml(c, l)
  if (out && c === code.value && l === lang.value) html.value = out
})

const wrap = ref(false)
const { copy, copied } = useClipboard({ copiedDuring: 1500 })
const pickerOpen = ref(false)
const langs = ref<string[]>(['text'])
watch(pickerOpen, async (o) => {
  if (o && langs.value.length < 2)
    langs.value = await languageList()
})
const label = computed(() => !explicit.value && !picked.value && detected.value ? `auto: ${detected.value}` : lang.value)

const root = ref<HTMLElement>()
onMounted(() => {
  registerCtx(root.value, {
    kind: 'code',
    items: () => [
      { label: 'Copy code', icon: 'i-lucide-copy', onSelect: () => copyText(code.value) },
      { label: 'Copy as Markdown', icon: 'i-lucide-file-code', onSelect: () => copyText('```' + (lang.value === 'text' ? '' : lang.value) + '\n' + code.value + '\n```') },
      { label: wrap.value ? 'Unwrap lines' : 'Wrap lines', icon: 'i-lucide-wrap-text', onSelect: () => { wrap.value = !wrap.value } },
      { label: 'Change language', icon: 'i-lucide-languages', onSelect: () => { pickerOpen.value = true } },
    ],
  })
})
</script>

<template>
  <div
    ref="root"
    :data-codeblock="code"
    class="my-1 overflow-hidden rounded-md border border-default bg-muted text-sm"
  >
    <div class="flex items-center gap-1 border-b border-default px-2 py-1 text-xs text-muted">
      <USelectMenu
        v-model:open="pickerOpen"
        :model-value="lang"
        :items="langs"
        searchable
        search-input-placeholder="Search language"
        size="xs"
        variant="ghost"
        color="neutral"
        class="w-40"
        :ui="{ content: 'min-w-48' }"
        icon="i-lucide-languages"
        aria-label="Code language"
        @update:model-value="pick($event as string)"
      >
        <template #default>
          {{ label }}
        </template>
      </USelectMenu>
      <span class="ml-1">{{ lines }} {{ lines === 1 ? 'line' : 'lines' }}</span>
      <UButton
        v-if="huge && !forced"
        label="Highlight"
        icon="i-lucide-sparkles"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="forced = true"
      />
      <UButton
        class="ml-auto"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Copy code"
        @click="copy(code)"
      />
    </div>
    <!-- eslint-disable vue/no-v-html -- HTML comes from Shiki or the escaped plainHtml fallback. -->
    <div
      class="code-body"
      :class="wrap ? 'code-wrap' : 'overflow-x-auto'"
      v-html="html"
    />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>
