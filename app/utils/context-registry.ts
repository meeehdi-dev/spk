// Things inside a message body (links, code blocks, quotes, spoilers) register their element here.
// The message's single context menu picks the innermost registered ancestor of the click target,
// so the innermost target's items come first and the message items sit in a "Message" submenu.
export interface CtxTarget {
  kind: 'link' | 'code' | 'inline-code' | 'quote' | 'spoiler' | 'mention' | 'user' | 'attachment' | 'reaction' | 'reply' | 'preview' | 'gif'
  /** Menu entries for this target. */
  items: () => Array<Record<string, unknown>>
}
const registry = new WeakMap<Element, CtxTarget>()

export function registerCtx(el: Element | null | undefined, target: CtxTarget) {
  if (el) registry.set(el, target)
  return () => {
    if (el)
      registry.delete(el)
  }
}

export function findCtx(from: EventTarget | null, root: Element): CtxTarget | null {
  for (let el = from as Element | null; el && el !== root; el = el.parentElement) {
    const t = registry.get(el)
    if (t) return t
  }
  return null
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
  useToast().add({ title: 'Copied', icon: 'i-lucide-check', duration: 1500 })
}

/** Copies an image to the clipboard as PNG (the one image type browsers accept); fails with a toast if the host blocks the fetch (CORS). */
export async function copyImage(url: string) {
  const toast = useToast()
  try {
    const bmp = await createImageBitmap(await (await fetch(url)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    const png = await new Promise<Blob>((ok, no) => canvas.toBlob(b => b ? ok(b) : no(new Error('encode')), 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    toast.add({ title: 'Image copied', icon: 'i-lucide-check', duration: 1500 })
  } catch {
    toast.add({ title: 'Could not copy the image', description: 'Its host may not allow it. Try Copy image link.', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

/** Saves a cross-origin image through a blob so the `download` attribute works. */
export async function saveImage(url: string, name: string) {
  try {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await (await fetch(url)).blob())
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
