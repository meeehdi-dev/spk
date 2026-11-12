import { noiseSuppressionAudioWorkletVitePlugin } from '@workadventure/noise-suppression/vite'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@nuxtjs/mdc', '@vite-pwa/nuxt'],
  devtools: { enabled: false },
  app: {
    head: {
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', href: '/logo.svg', sizes: 'any', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' },
      ],
      meta: [{ name: 'theme-color', content: '#18181b' }],
    },
  },
  experimental: { emitRouteChunkError: 'manual', checkOutdatedBuildInterval: 5 * 60 * 1000 },
  pwa: {
    strategies: 'injectManifest',
    srcDir: '../service-worker',
    filename: 'sw.js',
    injectRegister: false,
    injectManifest: { injectionPoint: undefined },
    client: { registerPlugin: false },
    devOptions: { enabled: false },
    pwaAssets: { disabled: true },
    manifest: {
      name: 'spk',
      short_name: 'spk',
      description: 'Private chat and voice for friends',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#18181b',
      theme_color: '#18181b',
      icons: [
        { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
  },
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
    listen(_server, listener: { getURLs: () => { type: string; url: string }[] }) {
      if (process.env.NODE_ENV !== 'development') return
      const tunnel = listener.getURLs().find(entry => entry.type === 'tunnel')
      if (!tunnel) return
      let url: URL
      try {
        url = new URL(tunnel.url)
      } catch {
        throw new Error('The development tunnel must provide a valid HTTPS URL')
      }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The development tunnel must provide a valid HTTPS URL')
      // The CLI calls listen before building Nitro, so its worker inherits the exact public auth origin.
      process.env.BETTER_AUTH_URL = url.origin
      console.info(`[auth] development tunnel origin=${url.origin}`)
    },
    'app:resolve'(app) {
      // The PWA module injects an empty asset helper even when generation is disabled.
      app.plugins = app.plugins.filter(plugin => !plugin.src.endsWith('/pwa-icons-plugin.ts'))
    },
    // Nuxt's bare `assets` alias breaks the package's `new URL('assets/…', import.meta.url)`, so its worklet/wasm/model aren't emitted.
    'vite:extendConfig'(config) {
      const alias = config.resolve?.alias
      if (alias && !Array.isArray(alias)) Reflect.deleteProperty(alias, 'assets')
    },
  },
  eslint: { config: { stylistic: false } },
  icon: { provider: 'server', serverBundle: 'local', clientBundle: { scan: true }, fallbackToApi: false },
})
