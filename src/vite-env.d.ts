/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key（公開可）。未設定ならゲスト＝完全ローカル動作。 */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
  /** 実行環境（development / staging / production）。 */
  readonly VITE_APP_ENV?: string
  /** コトノハ-grove- （novel platform）のオリジン。未設定なら投稿の導線を出さない。 */
  readonly VITE_PLATFORM_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
