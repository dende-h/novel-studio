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
        // 同期 API（/api/*）は絶対にキャッシュしない。SW をネットワーク直行（NetworkOnly）にし、
        // SPA のナビゲーションフォールバック（index.html 差し替え）の対象からも除外する。
        // これを怠ると古い manifest/work レスポンスが返り、同期が壊れる（Phase 2 の必須対策）。
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
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
    // functions/ は Pages Functions（同期サーバ）。crypto 等は node 環境で個別に動かす
    //（各テストファイル先頭の `// @vitest-environment node` で上書き）。
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'functions/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'dev-dist', 'e2e/**'],
  },
})
