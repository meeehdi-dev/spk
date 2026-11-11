export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: ['@nuxt/ui', '@vueuse/nuxt', '@nuxtjs/mdc'],
  app: {
    head: {
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }
      ],
      meta: [{ name: 'theme-color', content: '#18181b' }]
    }
  },
  css: ['~/assets/css/main.css'],
  icon: { provider: 'server', serverBundle: 'local', clientBundle: { scan: true }, fallbackToApi: false },
  nitro: {
    experimental: { websocket: true, tasks: true },
    scheduledTasks: { '0 * * * *': ['attachments:cleanup'] } // hourly: unsent uploads older than 24 h
  },
  vite: {
    optimizeDeps: {
      include: [
        '@vueuse/integrations/useSortable',
        'better-auth/client/plugins',
        'better-auth/vue',
        'livekit-client',
        'wavesurfer.js',
        'wavesurfer.js/plugins/regions'
      ]
    }
  },
  devtools: { enabled: false },
  runtimeConfig: {
    databasePath: './data/spk.db',
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' },
    livekit: { apiKey: '', apiSecret: '' },
    vapidPrivateKey: '',
    vapidSubject: '',
    klipyApiKey: '',
    public: { livekitUrl: '', vapidPublicKey: '' }
  }
})
