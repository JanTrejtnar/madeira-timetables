import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// shown in the footer so a deployed build can be told apart from a stale cached one
const buildTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Atlantic/Madeira', dateStyle: 'short', timeStyle: 'short' }).format(new Date());

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify(buildTime) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Madeira Autocarros',
        short_name: 'Autocarros',
        description: 'Jízdní řády autobusů na Madeiře (offline)',
        lang: 'cs',
        theme_color: '#0284c7',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // schedules + stop lists are precached; route geometries and PDFs are cached when first opened
        globPatterns: ['**/*.{js,css,html,svg,png}', 'data/schedules.json', 'data/pois.json', 'data/overview.json'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/data\/shapes\/.*\.json$/, handler: 'CacheFirst', options: { cacheName: 'shapes', expiration: { maxEntries: 400 } } },
          { urlPattern: /\/pdf\/.*\.(pdf|jpg)$/, handler: 'CacheFirst', options: { cacheName: 'pdfs', expiration: { maxEntries: 200 } } },
          { urlPattern: /^https:\/\/tile\.openstreetmap\.org\//, handler: 'CacheFirst', options: { cacheName: 'map-tiles', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } } },
        ],
      },
    }),
  ],
});
