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
    },
  ],
})
