<script setup lang="ts">
import type { MessageDto } from '../../../server/db/messages'

const props = defineProps<{ channelId: string; message?: MessageDto }>()
const open = defineModel<boolean>('open', { required: true })

const MIN = 2
const MAX = 10
const blank = () => [{ key: crypto.randomUUID(), id: undefined as string | undefined, label: '' }]
const question = ref('')
const options = ref<{ key: string; id?: string; label: string }[]>([])
const confirmOpen = ref(false)
const saving = ref(false)

// Reset the form each time the modal opens.
watch(
  open,
  o => {
    if (!o) return
    confirmOpen.value = false
    question.value = props.message?.body ?? ''
    options.value = props.message?.poll ? props.message.poll.options.map(p => ({ key: p.id, id: p.id, label: p.label })) : [...blank(), ...blank()]
  },
  { immediate: true },
)

const labels = computed(() => options.value.map(o => o.label.trim()))
const valid = computed(
  () =>
    !!question.value.trim() &&
    question.value.length <= 300 &&
    labels.value.length >= MIN &&
    labels.value.every(l => l && l.length <= 100) &&
    new Set(labels.value.map(l => l.toLowerCase())).size === labels.value.length,
)

const votes = computed(() => props.message?.poll?.options.reduce((n, o) => n + o.userIds.length, 0) ?? 0)
const optionsChanged = computed(() => {
  const old = props.message?.poll?.options ?? []
  return old.length !== options.value.length || old.some((o, i) => o.id !== options.value[i]!.id || o.label !== labels.value[i])
})

async function save(resetVotes: boolean) {
  const message = props.message!
  saving.value = true
  try {
    // The view updates from the message:edit frame, which fanOut also sends to the author.
    await $fetch(`/api/messages/${message.id}`, {
      method: 'PATCH',
      body: { body: question.value.trim(), poll: options.value.map((o, i) => ({ id: o.id, label: labels.value[i] })), resetVotes },
    })
    confirmOpen.value = false
    open.value = false
  } catch (e) {
    useToast().add({ title: errorText(e, 'Could not save the poll'), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}

function submit() {
  if (!valid.value) return
  if (props.message) {
    if (optionsChanged.value && votes.value > 0) confirmOpen.value = true
    else void save(false)
    return
  }
  const ok = useSocket().send({
    type: 'message:send',
    channelId: props.channelId,
    body: question.value.trim(),
    poll: labels.value.map(label => ({ label })),
    nonce: crypto.randomUUID(),
  })
  if (!ok) {
    useToast().add({ title: 'Not connected, try again in a moment', color: 'error', icon: 'i-lucide-wifi-off' })
    return
  }
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="message ? 'Edit poll' : 'Create poll'" description="Ask a question with 2 to 10 options.">
    <template #body>
      <form class="flex flex-col gap-4 compact:gap-3" @submit.prevent="submit">
        <UFormField label="Question">
          <UInput v-model="question" maxlength="300" class="w-full" autofocus />
        </UFormField>
        <UFormField label="Options">
          <div class="flex flex-col gap-2">
            <div v-for="(o, i) in options" :key="o.key" class="flex gap-2">
              <UInput v-model="o.label" maxlength="100" class="w-full" :aria-label="`Option ${i + 1}`" />
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                :aria-label="`Remove option ${i + 1}`"
                :disabled="options.length <= MIN"
                @click="options.splice(i, 1)"
              />
            </div>
            <UButton
              label="Add option"
              icon="i-lucide-plus"
              color="neutral"
              variant="soft"
              class="self-start"
              :disabled="options.length >= MAX"
              @click="options.push(...blank())"
            />
          </div>
        </UFormField>
        <UButton
          type="submit"
          :label="message ? 'Save' : 'Send'"
          :icon="message ? 'i-lucide-save' : 'i-lucide-send-horizontal'"
          :disabled="!valid"
          :loading="saving"
        />
      </form>
    </template>
  </UModal>
  <UModal v-model:open="confirmOpen" title="Change poll options" description="People have already voted. What should happen to their votes?">
    <template #footer>
      <UButton label="Keep votes" color="neutral" variant="soft" @click="save(false)" />
      <UButton label="Reset votes" icon="i-lucide-rotate-ccw" color="error" @click="save(true)" />
    </template>
  </UModal>
</template>
