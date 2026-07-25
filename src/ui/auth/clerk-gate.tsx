import { ClerkProvider, useClerk, useAuth as useClerkAuth, useUser } from '@clerk/clerk-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { getBillingStatus } from '@/ui/_api/billing'
import { AuthContext, type AuthState } from './auth-context'
import { deriveStatus } from './derive-status'

/** Clerk hooks を AuthState に橋渡しする内側。ClerkProvider 配下でのみ描画される。 */
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth()
  const { user } = useUser()
  const clerk = useClerk()

  const signedIn = isSignedIn === true

  // getToken の参照が毎レンダー変わっても effect を再実行しないよう ref で束ねる。
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken

  // 会員判定の真実は D1（/api/billing/status）。サインイン後に取得する。取得前は loaded=false。
  const [membership, setMembership] = useState<{ loaded: boolean; isMember: boolean }>({
    loaded: false,
    isMember: false,
  })

  useEffect(() => {
    if (!signedIn) {
      setMembership({ loaded: true, isMember: false })
      return
    }
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    // Checkout から戻った直後は webhook 反映が数秒遅れるので、member になるまで数回リトライ。
    const returning = params.get('billing') === 'return'
    ;(async () => {
      const tries = returning ? 6 : 1
      for (let i = 0; i < tries; i++) {
        const s = await getBillingStatus(() => getTokenRef.current())
        if (cancelled) return
        if (s?.isMember || i === tries - 1) {
          setMembership({ loaded: true, isMember: !!s?.isMember })
          break
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
      if (!cancelled && params.get('billing')) {
        const u = new URL(window.location.href)
        u.searchParams.delete('billing')
        window.history.replaceState({}, '', u.toString())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn])

  const hasPlan = signedIn && membership.isMember
  // サインイン済みで会員判定がまだ取れていない間は loading 扱い＝guest への一瞬のちらつきを防ぐ。
  const effectiveLoaded = isLoaded && (!signedIn || membership.loaded)

  const value: AuthState = {
    available: true,
    // member＝サインイン済み かつ 有効なサブスク。未課金は guest（同期オフ）に収束。
    status: deriveStatus({ isLoaded: effectiveLoaded, isSignedIn: signedIn, hasPlan }),
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
