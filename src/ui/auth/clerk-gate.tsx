import { ClerkProvider, useClerk, useAuth as useClerkAuth, useUser } from '@clerk/clerk-react'
import type { ReactNode } from 'react'
import { PLAN_KEY } from '@/core/billing/plan'
import { AuthContext, type AuthState } from './auth-context'
import { deriveStatus } from './derive-status'

/** Clerk hooks を AuthState に橋渡しする内側。ClerkProvider 配下でのみ描画される。 */
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, has, getToken } = useClerkAuth()
  const { user } = useUser()
  const clerk = useClerk()

  const signedIn = isSignedIn === true
  // 会員判定は Clerk JWT クレーム（has({ plan: PLAN_KEY })）が単一の真実＝サーバ verifyMember と同条件。
  const hasPlan = signedIn && has ? has({ plan: PLAN_KEY }) : false

  const value: AuthState = {
    available: true,
    // member＝サインイン済み かつ 課金。未課金は guest（同期オフ）に収束し、CTA は isSignedIn で出し分ける。
    status: deriveStatus({ isLoaded, isSignedIn: signedIn, hasPlan }),
    isSignedIn: signedIn,
    userId: user?.id ?? null,
    displayName: user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? null,
    openSignIn: () => clerk.openSignIn(),
    openSignUp: () => clerk.openSignUp(),
    signOut: () => void clerk.signOut(),
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
