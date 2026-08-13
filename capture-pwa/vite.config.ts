import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: true,
    // getUserMedia requires a secure context; vite's dev server over plain
    // http is only treated as secure on localhost. Use --host with a
    // trusted cert (e.g. mkcert) or tunnel over https for device testing.
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: 'index.html',
        debug: 'debug.html',
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Gavan Guided Capture',
        short_name: 'Gavan Capture',
        description: 'Guided smile capture for shade matching',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Model + wasm are large; raise the default 2MB precache limit.
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,ico,task,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /\/(models|wasm)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'capture-assets',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
});
