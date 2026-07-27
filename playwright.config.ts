import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    env: {
      // E2E は常にゲストで走らせる（e2e/smoke.spec.ts のゲスト回帰テストの前提）。
      // ローカル .env に Clerk の pk があると、起動直後に AuthProvider の Suspense が
      // ゲストツリー→ClerkGate ツリーへ丸ごと差し替わり（＝アプリ全体が再マウント）、
      // その瞬間に開いていたダイアログが閉じてテストが不安定になるため明示的に無効化する。
      VITE_CLERK_PUBLISHABLE_KEY: '',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // モバイル用の spec を除外する。既存の spec は広い画面を前提に本文幅などを
      // assert しており、スマホ幅で走らせると落ちるため、両者はプロジェクトで分ける。
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      // スマホ回帰。CI は chromium しか入れない（ci.yml の playwright install --with-deps chromium）ため
      // WebKit の iPhone ではなく Chromium ベースの Pixel 5（isMobile + hasTouch）でエミュレートする。
      // iOS 固有のキーボード・visualViewport・エッジスワイプは原理的にここでは検証できず、実機確認に委ねる。
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
})
