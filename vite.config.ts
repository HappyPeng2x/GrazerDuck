import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@duckdb/duckdb-wasm-shell'],
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'GrazerDuck — DuckDB Terminal',
        short_name: 'GrazerDuck',
        description: 'A fully offline DuckDB SQL terminal. All your data stays on your device — zero network calls after install.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        orientation: 'landscape',
        start_url: './',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,ico,png,ttf,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024,
      },
    }),
  ],
});
