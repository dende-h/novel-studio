import { ClerkProvider, useClerk, useAuth as useClerkAuth, useUser } from '@clerk/clerk-react'
import type { ReactNode } from 'react'
import { clearSessionToken } from '@/ui/_api/session'
import { AuthContext, type AuthState } from './auth-context'

/** Clerk hooks を AuthState に橋渡しする内側。ClerkProvider 配下でのみ描画される。 */
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth()
  const { user } = useUser()
  const clerk = useClerk()

  const value: AuthState = {
    available: true,
    // member 判定は当面「サインイン済み」のスタブ（有料プランは Phase 4）。
    status: !isLoaded ? 'loading' : isSignedIn ? 'member' : 'guest',
    userId: user?.id ?? null,
    displayName: user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? null,
    openSignIn: () => clerk.openSignIn(),
    openSignUp: () => clerk.openSignUp(),
    signOut: () => {
      // 端末ローカルのセッショントークンを破棄してからサインアウト（次ユーザーへの残留防止）。
      clearSessionToken()
      void clerk.signOut()
    },
    getToken: () => getToken(),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Clerk を含むチャンク。publishable key があるときだけ動的 import される。
 * ゲスト（pk なし＝大多数）はこのチャンクを一切ダウンロードしない（ローカルファースト）。
 */
export default function ClerkGate({
  publishableKey,
  children,
}: {
  publishableKey: string
  children: ReactNode
}) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  )
}
