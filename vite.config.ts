/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Clerk チャンクは pk 設定時のみ動的 import される。ゲスト（大多数）に
        // precache させない（lazy 資産は precache 対象外にする方針。JP フォントと同じ規律）。
        globIgnores: ['**/clerk-gate-*.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // ユニット/結合のみを vitest 対象に。e2e(Playwright)は test:e2e で別ランナー。
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'dev-dist', 'e2e/**'],
  },
})
