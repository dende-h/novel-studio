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
  // Clerk チャンク読み込み中はゲストとして描画し、アプリを止めない。
  const guest = <AuthContext.Provider value={GUEST_AUTH_STATE}>{children}</AuthContext.Provider>
  return (
    <Suspense fallback={guest}>
      <ClerkGate publishableKey={PUBLISHABLE_KEY}>{children}</ClerkGate>
    </Suspense>
  )
}
