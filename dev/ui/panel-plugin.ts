import { defineNuxtPlugin } from '#imports'

import SandboxPanel from './SandboxPanel.vue'

// SettingsModal shows a "UI sandbox" tab when this global component exists.
export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.vueApp.component('UiSandboxPanel', SandboxPanel)
})
