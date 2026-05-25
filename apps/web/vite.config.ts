import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'cache-control-headers',
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          // Hashed assets are content-addressed — safe to cache forever.
          if (req.url?.startsWith('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          } else {
            // sw.js, index.html, manifest: no-store so browsers always fetch
            // fresh after a deploy and never run a stale service worker.
            res.setHeader('Cache-Control', 'no-store')
          }
          next()
        })
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globIgnores: ['**/sw-dev.js'],
      },
      includeAssets: ['favicon.svg', 'icons.svg'],
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'GEM — Group Event Manager',
        short_name: 'GEM',
        description: 'Plan events and chat with your friend group',
        theme_color: '#4f46e5',
        background_color: '#030712',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.png',
            sizes: '500x500',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        additionalManifestEntries: [{ url: '/offline.html', revision: null }],
        // P4: API and WebSocket traffic must never be served from the cache.
        // Without this a second user on a shared device could see the prior
        // user's data briefly before fresh network requests complete.
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly' as const,
          },
          {
            urlPattern: /^wss?:\/\//,
            handler: 'NetworkOnly' as const,
          },
          // User-uploaded images from the same origin: serve stale while revalidating in background.
          // Safe because images are content-addressed (URL changes on update).
          {
            urlPattern: /\/uploads\/.*\.(jpe?g|png|gif|webp|avif|heic|heif)(\?.*)?$/i,
            handler: 'StaleWhileRevalidate' as const,
            options: {
              cacheName: 'gem-images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io', '.ngrok.app', '.ngrok.dev', 'localhost', '127.0.0.1', 'gem.aidanlenahan.com', 'gem-dev.aidanlenahan.com'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    // P3: 'hidden' generates source maps for Sentry error tracking but does not
    // reference them in the bundle, so they are not publicly accessible via DevTools.
    sourcemap: 'hidden',
    rollupOptions: {
      treeshake: { moduleSideEffects: false },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@sentry')) return 'vendor-sentry'
          if (id.includes('@tanstack')) return 'vendor-query'
          if (id.includes('socket.io-client') || id.includes('engine.io-client') || id.includes('socket.io-parser')) return 'vendor-socket'
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router') || id.includes('scheduler')) return 'vendor-react'
          return 'vendor'
        },
      },
    },
  },
})
