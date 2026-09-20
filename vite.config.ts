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
        // LP（マーケティング静的ページ）はアプリの SW 資産に含めない。
        //
        // clerk-gate は precache から外さない。pk 設定時（＝本番）はこのチャンクを読み終える
        // まで一画面も描かないので、初回描画に必須の資産であり、index.html と同じ世代の
        // precache に入っている必要がある。外すと 2 通りで白画面になる：
        //   ① 電波が切れると取得に失敗する（SW が返す shell は動くのに中身が来ない）
        //   ② 新しくデプロイした直後、SW が古い index/entry を返している間は、そこが指す
        //      旧ハッシュの clerk-gate がサーバに無く 404 になる
        // なお節約になるのは 1.6KB のこのチャンクだけで、実体の Clerk SDK（約88KB）は
        // もともと precache されている。外す利得はほぼ無く、失うものが大きい。
        globIgnores: ['lp/**'],
        // 同期 API（/api/*）は絶対にキャッシュしない。SW をネットワーク直行（NetworkOnly）にし、
        // SPA のナビゲーションフォールバック（index.html 差し替え）の対象からも除外する。
        // これを怠ると古い manifest/work レスポンスが返り、同期が壊れる（Phase 2 の必須対策）。
        // /lp/ は独立した静的 LP。SPA フォールバックでアプリに差し替えられないよう除外する。
        navigateFallbackDenylist: [/^\/api\//, /^\/lp/, /^\/game-templates\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          // 運営テンプレ（背景・立ち絵）。目録は変わりうるので網を先に、実体は URL に内容ハッシュが
          // 付く（?v=）ので取ったら手元を先に。precache には入れない（1 枚 100KB 超×百枚を
          // 初回に落とさせない）。/api/ の外に置いてあるのはこのため
          {
            urlPattern: ({ url }) => url.pathname === '/game-templates/manifest.json',
            handler: 'NetworkFirst',
            options: { cacheName: 'game-templates-manifest', networkTimeoutSeconds: 5 },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/game-templates/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-templates',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
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
