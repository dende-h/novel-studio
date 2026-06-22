/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key（公開可）。未設定ならゲスト＝完全ローカル動作。 */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
  /** 実行環境（development / staging / production）。 */
  readonly VITE_APP_ENV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
