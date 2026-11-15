<script setup lang="ts">
const voice = useVoice()
const now = useNow({ scheduler: cb => useIntervalFn(cb, 2000) })
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
const chart = computed(() => {
  const end = now.value.getTime()
  const history = voice.pingHistory.value.filter(p => p.time >= end - 60_000)
  const values = history.flatMap(p => (p.ping === null ? [] : [p.ping]))
  const max = Math.max(100, ...values)
  let path = ''
  let gap = true
  let lastTime = 0
  for (const point of history) {
    if (point.ping === null) {
      gap = true
      continue
    }
    const x = 2 + ((point.time - (end - 60_000)) / 60_000) * 276
    const y = 62 - (point.ping / max) * 56
    path += `${gap || point.time - lastTime > 5000 ? 'M' : 'L'}${x},${y} `
    // A short segment makes a single sample visible too.
    if (gap) path += `L${x + 0.1},${y} `
    gap = false
    lastTime = point.time
  }
  return {
    path,
    max,
    summary: values.length
      ? `Signaling ping over the last 60 seconds: ${Math.min(...values)} to ${Math.max(...values)} milliseconds.`
      : 'No ping samples available yet.',
  }
})
</script>

<template>
  <UPopover :content="{ align: 'start', side: 'top' }">
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
            <path d="M2 62H278" class="stroke-default" fill="none" />
            <path :d="chart.path" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <div class="flex justify-between text-xs text-dimmed"><span>60s ago</span><span>0–{{ chart.max }} ms · now</span></div>
        </div>
        <dl class="space-y-2 text-xs">
          <div v-for="[label, value] in metrics" :key="label" class="flex justify-between gap-3">
            <dt class="text-muted">{{ label }}</dt>
            <dd class="text-right tabular-nums">{{ value }}</dd>
          </div>
        </dl>
        <p v-if="voice.audioBlocked.value" class="text-xs text-warning">Audio playback is blocked by your browser.</p>
        <p v-if="voice.microphone.value === 'unavailable'" class="text-xs text-warning">Microphone unavailable. Check device access and permissions.</p>
        <p class="text-xs text-dimmed">
          Updated every 2s. Signaling ping is separate from media latency. Audio metrics depend on active tracks and browser support.
        </p>
      </section>
    </template>
  </UPopover>
</template>
