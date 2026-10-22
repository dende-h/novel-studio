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
        // 推敲画面の解析器（lindera の wasm 1.7MB）も precache に入れない。推敲画面を開いた人だけが
        // 取りに行き、下の runtimeCaching で 2 回目以降はオフラインでも読める（COT-40）。辞書の zip は
        // public/dict/ に置くが、既定の globPatterns（js/wasm/css/html）に zip は入らない。
        // 入れ忘れると 2MiB 超のアセットで vite-plugin-pwa が build を止める。
        globIgnores: ['lp/**', '**/*.wasm'],
        // 同期 API（/api/*）は絶対にキャッシュしない。SW をネットワーク直行（NetworkOnly）にし、
        // SPA のナビゲーションフォールバック（index.html 差し替え）の対象からも除外する。
        // これを怠ると古い manifest/work レスポンスが返り、同期が壊れる（Phase 2 の必須対策）。
        // /lp/ は独立した静的 LP。SPA フォールバックでアプリに差し替えられないよう除外する。
        // クローラー・AI 向けのテキスト（llms.txt・robots.txt・sitemap.xml・.well-known）も同じ。
        // 一度アプリを開いた人がブラウザで直接開いたとき、アプリの画面に化けないように。
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/lp/,
          /^\/game-templates\//,
          /^\/llms(-full)?\.txt$/,
          /^\/robots\.txt$/,
          /^\/sitemap\.xml$/,
          /^\/\.well-known\//,
          // 推敲画面の辞書と、そのライセンス表記（ヘルプからリンクする）。
          /^\/dict\//,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          // 推敲画面の解析器（wasm）。ファイル名に内容ハッシュが付くので、取ったら手元を先に。
          // 辞書の zip は Worker が Cache Storage（ns-dict-v1）に自分で置くので、ここでは扱わない。
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/assets/') && url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'proofread-analyzer',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
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
  // 推敲画面の解析 Worker（COT-40）は ES モジュールで出す（lindera-wasm が import.meta.url で wasm を引くため）。
  worker: { format: 'es' },
  // lindera-wasm は wasm を import.meta.url で引くので、依存の事前バンドルから外す（README の指示）。
  optimizeDeps: { exclude: ['lindera-wasm'] },
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
