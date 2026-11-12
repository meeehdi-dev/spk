<script setup lang="ts">
// An <img> that, for GIFs with "Play GIFs only on hover" on, shows its first frame on a canvas until the parent link/button is hovered or focused.
// `class` goes to both the image and the still, so sizing and the spoiler blur apply to each. The image stays in flow (hidden) so it keeps the layout.
defineOptions({ inheritAttrs: false })
const props = defineProps<{ src: string; alt: string; gif: boolean }>()
const emit = defineEmits<{ load: []; error: [] }>()
const onHover = useGifOnHover()
const wrap = ref<HTMLElement>()
const img = ref<HTMLImageElement>()
const canvas = ref<HTMLCanvasElement>()
const parent = ref<HTMLElement>()
const hovered = ref(false)
const focused = ref(false)
const stilled = ref(false)
const still = computed(() => props.gif && onHover.value && !(hovered.value || focused.value))

function draw() {
  const i = img.value
  const c = canvas.value
  if (!props.gif || !onHover.value || !i?.complete || !c || !i.naturalWidth) return
  c.width = i.naturalWidth
  c.height = i.naturalHeight
  c.getContext('2d')?.drawImage(i, 0, 0)
  stilled.value = true
}
function onLoad() {
  draw()
  emit('load')
}
onMounted(() => {
  parent.value = wrap.value?.parentElement ?? undefined
})
watchPostEffect(draw)
useEventListener(parent, 'pointerenter', () => (hovered.value = true))
useEventListener(parent, 'pointerleave', () => (hovered.value = false))
useEventListener(parent, 'focusin', () => (focused.value = true))
useEventListener(parent, 'focusout', () => (focused.value = false))
</script>

<template>
  <span ref="wrap" class="relative block w-fit max-w-full">
    <img ref="img" v-bind="$attrs" :src="src" :alt="alt" :class="{ invisible: still && stilled }" @load="onLoad" @error="emit('error')" />
    <canvas v-if="gif && onHover" v-show="still && stilled" ref="canvas" role="img" :aria-label="alt" :class="[$attrs.class, 'absolute inset-0 size-full']" />
  </span>
</template>
