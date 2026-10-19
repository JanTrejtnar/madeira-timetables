import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Madeira Autocarros',
        short_name: 'Autocarros',
        description: 'Jízdní řády autobusů na Madeiře (offline)',
        lang: 'cs',
        theme_color: '#0284c7',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // schedules + stop lists are precached; route geometries and PDFs are cached when first opened
        globPatterns: ['**/*.{js,css,html,svg}', 'data/schedules.json'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/data\/shapes\/.*\.json$/, handler: 'CacheFirst', options: { cacheName: 'shapes', expiration: { maxEntries: 400 } } },
          { urlPattern: /\/pdf\/.*\.(pdf|jpg)$/, handler: 'CacheFirst', options: { cacheName: 'pdfs', expiration: { maxEntries: 200 } } },
          { urlPattern: /^https:\/\/tile\.openstreetmap\.org\//, handler: 'CacheFirst', options: { cacheName: 'osm-tiles', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } } },
        ],
      },
    }),
  ],
});
