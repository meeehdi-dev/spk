import { noiseSuppressionAudioWorkletVitePlugin } from '@workadventure/noise-suppression/vite'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@nuxtjs/mdc'],
  devtools: { enabled: false },
  app: {
    head: {
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
      meta: [{ name: 'theme-color', content: '#18181b' }],
    },
  },
  experimental: { emitRouteChunkError: 'manual' },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    databasePath: './data/spk.db',
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' },
    livekit: { apiKey: '', apiSecret: '' },
    vapidPrivateKey: '',
    vapidSubject: '',
    klipyApiKey: '',
    public: { livekitUrl: '', vapidPublicKey: '' },
  },
  compatibilityDate: '2025-07-15',
  nitro: {
    experimental: { websocket: true, tasks: true },
    scheduledTasks: { '0 * * * *': ['attachments:cleanup'] }, // hourly: unsent uploads older than 24 h
  },
  vite: {
    plugins: [noiseSuppressionAudioWorkletVitePlugin()],
    optimizeDeps: {
      include: [
        '@vueuse/integrations/useSortable',
        'better-auth/client/plugins',
        'better-auth/vue',
        'emoji-picker-element',
        'highlight.js/lib/core',
        'highlight.js/lib/languages/bash',
        'highlight.js/lib/languages/c',
        'highlight.js/lib/languages/cpp',
        'highlight.js/lib/languages/csharp',
        'highlight.js/lib/languages/css',
        'highlight.js/lib/languages/diff',
        'highlight.js/lib/languages/go',
        'highlight.js/lib/languages/java',
        'highlight.js/lib/languages/javascript',
        'highlight.js/lib/languages/json',
        'highlight.js/lib/languages/php',
        'highlight.js/lib/languages/python',
        'highlight.js/lib/languages/ruby',
        'highlight.js/lib/languages/rust',
        'highlight.js/lib/languages/sql',
        'highlight.js/lib/languages/typescript',
        'highlight.js/lib/languages/xml',
        'highlight.js/lib/languages/yaml',
        'livekit-client',
        'shiki',
        'wavesurfer.js',
        'wavesurfer.js/plugins/regions',
      ],
    },
  },
  hooks: {
    // Nuxt's bare `assets` alias breaks the package's `new URL('assets/…', import.meta.url)`, so its worklet/wasm/model aren't emitted.
    'vite:extendConfig'(config) {
      const alias = config.resolve?.alias
      if (alias && !Array.isArray(alias)) Reflect.deleteProperty(alias, 'assets')
    },
  },
  eslint: { config: { stylistic: false } },
  icon: { provider: 'server', serverBundle: 'local', clientBundle: { scan: true }, fallbackToApi: false },
})
