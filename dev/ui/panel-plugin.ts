import { UApp } from '#components'
import { createVNode, render } from 'vue'

import { defineNuxtPlugin } from '#imports'

import SandboxPanel from './SandboxPanel.vue'

export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.hook('app:mounted', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const vnode = createVNode(UApp, {}, { default: () => createVNode(SandboxPanel) })
    vnode.appContext = nuxtApp.vueApp._context
    render(vnode, host)
    const cleanup = () => {
      render(null, host)
      host.remove()
    }
    nuxtApp.vueApp.onUnmount(cleanup)
    if (import.meta.hot) import.meta.hot.dispose(cleanup)
  })
})
