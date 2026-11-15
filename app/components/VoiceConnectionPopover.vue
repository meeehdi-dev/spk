<script setup lang="ts">
import { pingChart } from '~/utils/ping-chart'

const voice = useVoice()
const open = ref(false)
const reducedMotion = usePreferredReducedMotion()
const clipId = useId()
const { now, pause, resume } = useNow({
  controls: true,
  scheduler: cb => useRafFn(cb, { immediate: false, fpsLimit: () => (reducedMotion.value === 'reduce' ? 0.5 : null) }),
})
watch(open, value => {
  if (value) {
    now.value = new Date()
    resume()
  } else pause()
})
const metrics = computed(() => {
  const d = voice.diagnostics.value
  const format = (value: number | null | undefined, unit: string) => (value == null ? 'Unavailable' : `${value.toFixed(1)} ${unit}`)
  return [
    ['Media round-trip', format(d?.mediaRtt, 'ms')],
    ['Audio jitter (worst track)', format(d?.jitter, 'ms')],
    ['Incoming audio packet loss', format(d?.packetLoss, '%')],
    ['Audio upload', format(d?.upload, 'kbps')],
    ['Audio download', format(d?.download, 'kbps')],
    ['Connection quality', d?.quality && d.quality !== 'unknown' ? d.quality : 'Unavailable'],
  ]
})
// Render one sample behind so incoming segments slide into view instead of popping in.
const sampledChart = computed(() => pingChart(voice.pingHistory.value, now.value.getTime() - 2000))
const ceiling = useTransition(() => sampledChart.value.max, {
  duration: 300,
  disabled: computed(() => !open.value || reducedMotion.value === 'reduce'),
})
const chart = computed(() => pingChart(voice.pingHistory.value, now.value.getTime() - 2000, ceiling.value))
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start', side: 'top' }">
    <UButton
      color="neutral"
      variant="link"
      size="xs"
      icon="i-lucide-signal"
      class="max-w-full p-0 text-muted"
      :ui="{ label: 'truncate' }"
      :label="voice.connectionLabel.value"
      aria-label="Voice connection diagnostics"
    />
    <template #content>
      <section class="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-4" aria-label="Voice connection diagnostics">
        <div>
          <h3 class="text-sm font-medium">Voice connection</h3>
          <p class="text-xs text-muted">{{ voice.connectionLabel.value }}</p>
        </div>
        <div>
          <div class="flex items-baseline justify-between text-xs">
            <span class="text-muted">Signaling ping</span>
            <span class="font-medium tabular-nums">{{ voice.ping.value === null ? 'Unavailable' : `${voice.ping.value} ms` }}</span>
          </div>
          <svg viewBox="0 0 280 68" class="mt-2 h-20 w-full text-muted" role="img" :aria-label="chart.summary">
            <defs>
              <clipPath :id="clipId"><rect x="2" y="0" width="276" height="68" /></clipPath>
            </defs>
            <path d="M2 62H278" class="stroke-default" fill="none" />
            <path :d="chart.path" :clip-path="`url(#${clipId})`" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <div class="flex justify-between text-xs text-dimmed"><span>60s ago</span><span>0–{{ Math.round(chart.max) }} ms · now</span></div>
        </div>
        <dl class="space-y-2 text-xs">
          <div v-for="[label, value] in metrics" :key="label" class="flex justify-between gap-3">
            <dt class="text-muted">{{ label }}</dt>
            <dd class="text-right tabular-nums">{{ value }}</dd>
          </div>
        </dl>
        <div v-if="voice.audioBlocked.value || voice.microphone.value === 'unavailable'" class="space-y-1 text-xs text-warning" role="status">
          <p v-if="voice.audioBlocked.value">Audio playback is blocked by your browser.</p>
          <p v-if="voice.microphone.value === 'unavailable'">Microphone unavailable. Check device access and permissions.</p>
        </div>
      </section>
    </template>
  </UPopover>
</template>
