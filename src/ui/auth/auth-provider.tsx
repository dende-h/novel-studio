import { lazy, type ReactNode, Suspense } from 'react'
import { AuthContext, GUEST_AUTH_STATE } from './auth-context'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Clerk 一式は別チャンク。pk が設定された時だけ読み込む（ゲストのバンドルを軽く保つ）。
const ClerkGate = lazy(() => import('./clerk-gate'))

/**
 * 認証プロバイダ。publishable key があるときだけ Clerk を有効化する。
 * 無ければゲスト既定を流し込み、アプリは完全ローカルで動く（既存挙動と同一・既存テストも素通り）。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PUBLISHABLE_KEY) {
    return <AuthContext.Provider value={GUEST_AUTH_STATE}>{children}</AuthContext.Provider>
  }
  // fallback には children を置かない。以前はゲスト版 children を fallback に描いていたが、
  // その場合 children は「fallback の木」と「ClerkGate の木」の二か所に現れ、Clerk チャンクが
  // 解決した瞬間に React が親を差し替えてサブツリー（Root）ごと再マウントする。結果、初回ダイアログの
  // 入場アニメが二度走って「一瞬二重に見える」ちらつきになっていた。fallback を null にして
  // children を ClerkGate 配下だけに置けば一度きりのマウントで済む。読み込み中は body の紙色
  // 背景（--background）が見えるだけで、チャンクがキャッシュ済みなら体感ほぼ即時。
  return (
    <Suspense fallback={null}>
      <ClerkGate publishableKey={PUBLISHABLE_KEY}>{children}</ClerkGate>
    </Suspense>
  )
}
