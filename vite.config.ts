/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from a sub-path on GitHub Pages (BASE_PATH=/mobios/); '/' everywhere else.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'robots.txt', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Mobios',
        short_name: 'Mobios',
        description: 'Corte modelos 3D em partes imprimíveis com encaixes — direto no navegador, também offline.',
        lang: 'pt-BR',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#121316',
        background_color: '#0e0f12',
        categories: ['productivity', 'utilities', 'design'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Installed app opens models straight from the file manager.
        file_handlers: [
          {
            action: base,
            accept: {
              'model/stl': ['.stl'],
              'model/obj': ['.obj'],
              'model/3mf': ['.3mf'],
              'application/x-mobios': ['.mobios', '.fenda'],
            },
          },
        ],
      },
      workbox: {
        // Everything, including the geometry WASM, is precached: the app works offline.
        globPatterns: ['**/*.{js,css,html,wasm,woff2,png,svg,txt}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/property/**/*.test.ts', 'tests/bench/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});
