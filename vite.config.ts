import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png', 'robots.txt', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Blue Monday Admin',
        short_name: 'BM Admin',
        description: 'Quotes, invoices, payments and expenses for Blue Monday Studios',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#071b3a',
        theme_color: '#071b3a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Data always comes from Supabase over the network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only the Latin font files: the browser fetches other scripts on demand if ever needed.
        globIgnores: [
          '**/*-{cyrillic,cyrillic-ext,vietnamese}-*',
          // jsPDF's optional HTML-rendering helpers: never used by the app
          '**/html2canvas-*',
          '**/purify.es-*',
          '**/index.es-*',
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
