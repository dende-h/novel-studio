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
  // graceUntil は解約後の復元猶予（>now なら「復元のみ」導線を出す）。
  const [membership, setMembership] = useState<{
    loaded: boolean
    isMember: boolean
    graceUntil: number | null
  }>({
    loaded: false,
    isMember: false,
    graceUntil: null,
  })

  useEffect(() => {
    if (!signedIn) {
      // 未サインイン時は会員判定を「未取得(loaded:false)」に保つ。ここで loaded:true にすると、
      // リロード直後（Clerk 読込前は signedIn=false → 直後に true）に、会員 API を取り直す前の
      // stale な isMember:false が残り、一瞬 guest＝オンボーディング（料金画面）がちらつく。
      // 未サインイン確定時の描画は effectiveLoaded の `!signedIn` 短絡で loading にならない。
      setMembership({ loaded: false, isMember: false, graceUntil: null })
      return
    }
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    // Checkout から戻った直後は webhook 反映が数秒遅れるので、member になるまで数回リトライ。
    const returning = params.get('billing') === 'return'
    ;(async () => {
      try {
        const tries = returning ? 6 : 1
        for (let i = 0; i < tries; i++) {
          const s = await getBillingStatus(() => getTokenRef.current())
          if (cancelled) return
          if (s?.isMember || i === tries - 1) {
            setMembership({
              loaded: true,
              isMember: !!s?.isMember,
              graceUntil: s?.graceUntil ?? null,
            })
            break
          }
          await new Promise((r) => setTimeout(r, 1500))
        }
      } catch {
        // ここで例外を逃すと setMembership が呼ばれず status が 'loading' のまま固まる
        // （ヘッダーのアカウント欄が空白・リロードまで復帰しない）。想定外の失敗でも
        // 「非会員として確定」に倒す。会員なら次のリロード/再取得で member に戻る。
        if (!cancelled) setMembership({ loaded: true, isMember: false, graceUntil: null })
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
  // 解約後の猶予期間内（非会員だが grace_until が未来）は「復元のみ」導線を出す。
  const canRestore = signedIn && !membership.isMember && (membership.graceUntil ?? 0) > Date.now()
  // サインイン済みで会員判定がまだ取れていない間は loading 扱い＝guest への一瞬のちらつきを防ぐ。
  const effectiveLoaded = isLoaded && (!signedIn || membership.loaded)

  const value: AuthState = {
    available: true,
    // member＝サインイン済み かつ 有効なサブスク。未課金は guest（同期オフ）に収束。
    status: deriveStatus({ isLoaded: effectiveLoaded, isSignedIn: signedIn, hasPlan }),
    isSignedIn: signedIn,
    userId: user?.id ?? null,
    graceUntil: membership.graceUntil,
    canRestore,
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
